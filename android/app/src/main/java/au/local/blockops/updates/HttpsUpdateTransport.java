package au.local.blockops.updates;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;

/** HTTPS only, without ambient credentials, implicit redirects, or unbounded response bodies. */
public final class HttpsUpdateTransport {
    public interface ConnectionOpener { HttpsURLConnection open(URL url) throws IOException; }

    public static final class Response {
        public final byte[] bytes;
        public final int status;
        public final String retryAfter, rateLimitReset;
        public final Long serverRetryUntilWallMillis;

        private Response(byte[] bytes, int status, String retryAfter, String rateLimitReset, long now) {
            this.bytes = bytes;
            this.status = status;
            this.retryAfter = retryAfter;
            this.rateLimitReset = rateLimitReset;
            this.serverRetryUntilWallMillis = retryDeadline(retryAfter, rateLimitReset, now);
        }
    }

    private static final long DEADLINE_MILLIS = 5 * 60 * 1000;
    private final ConnectionOpener opener;
    private final UpdatePorts.Clock clock;

    public HttpsUpdateTransport(ConnectionOpener opener, UpdatePorts.Clock clock) {
        this.opener = java.util.Objects.requireNonNull(opener);
        this.clock = java.util.Objects.requireNonNull(clock);
    }

    public Response read(URI uri, int limit, UpdateCancellation cancellation) throws UpdatePorts.Failure {
        if (limit < 0 || limit > UpdatePolicy.MAX_METADATA_BYTES) throw transferFailure();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(Math.min(limit, 8192));
        return transfer(uri, bytes, limit, false, cancellation, null).response(bytes.toByteArray());
    }

    public String copy(URI uri, OutputStream output, long expectedSize, UpdateCancellation cancellation,
            UpdatePorts.Progress progress) throws UpdatePorts.Failure {
        if (expectedSize <= 0 || expectedSize > UpdatePolicy.MAX_APK_BYTES) throw transferFailure();
        Transfer transfer = transfer(uri, output, expectedSize, true, cancellation, progress);
        if (transfer.status != 200) throw new UpdatePorts.Failure("http_error", "The update server refused the request.",
                retryDeadline(transfer.retryAfter, transfer.rateLimitReset, transfer.wall));
        return transfer.digest;
    }

    private Transfer transfer(URI initial, OutputStream output, long limit, boolean exact,
            UpdateCancellation token, UpdatePorts.Progress progress) throws UpdatePorts.Failure {
        long started = clock.elapsedMillis();
        URI uri = initial;
        try {
            for (int hops = 0; ; hops++) {
                token.check();
                UpdatePolicy.requireRedirectUri(uri, hops);
                remaining(started, token);
                HttpsURLConnection connection = opener.open(uri.toURL());
                try (Resources resources = new Resources(connection)) {
                    token.register(resources);
                    token.check();
                    connection.setInstanceFollowRedirects(false);
                    connection.setUseCaches(false);
                    connection.setConnectTimeout((int) Math.min(10_000, remaining(started, token)));
                    connection.setReadTimeout((int) Math.min(30_000, remaining(started, token)));
                    connection.setRequestProperty("Accept", "application/octet-stream, application/vnd.github+json");
                    connection.setRequestProperty("Accept-Encoding", "identity");
                    connection.setRequestProperty("User-Agent", "BlockOps-Updater");
                    int status = connection.getResponseCode();
                    remaining(started, token);
                    if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                        String location = connection.getHeaderField("Location");
                        if (location == null || location.length() > 8192) throw transferFailure();
                        uri = uri.resolve(new URI(location));
                        UpdatePolicy.requireRedirectUri(uri, hops + 1);
                        continue;
                    }
                    Transfer result = new Transfer(status, header(connection, "Retry-After"),
                            header(connection, "X-RateLimit-Reset"), clock.wallMillis());
                    if (status != 200) return result; // Never read an error body (or return it to a caller).
                    String encoding = connection.getHeaderField("Content-Encoding");
                    if (encoding != null && !encoding.equalsIgnoreCase("identity")) throw transferFailure();
                    long declared = contentLength(connection);
                    if (declared > limit || (exact && declared >= 0 && declared != limit)) throw transferFailure();
                    InputStream input = connection.getInputStream();
                    resources.attach(input);
                    token.check();
                    MessageDigest digest = sha256();
                    byte[] buffer = new byte[8192];
                    long count = 0;
                    while (true) {
                        connection.setReadTimeout((int) Math.min(30_000, remaining(started, token)));
                        int size = input.read(buffer, 0, (int) Math.min(buffer.length, limit - count + 1));
                        remaining(started, token);
                        if (size == -1) break;
                        if (size == 0) continue;
                        count += size;
                        if (count > limit) throw transferFailure();
                        output.write(buffer, 0, size);
                        digest.update(buffer, 0, size);
                        // cancel() marks its token under this same monitor. A callback cannot start afterwards.
                        synchronized (token) {
                            token.check();
                            if (progress != null) progress.onBytes(count, limit);
                        }
                        remaining(started, token);
                    }
                    if ((exact && count != limit) || (declared >= 0 && count != declared)) throw transferFailure();
                    result.digest = hex(digest.digest());
                    return result;
                }
            }
        } catch (UpdatePorts.Failure failure) {
            throw failure;
        } catch (IOException | java.net.URISyntaxException | RuntimeException failure) {
            token.check();
            throw transferFailure(); // No cause: signed CDN URLs can occur in platform exception messages.
        }
    }

    private long remaining(long started, UpdateCancellation token) throws UpdatePorts.Failure {
        token.check();
        long elapsed = clock.elapsedMillis() - started;
        if (elapsed < 0 || elapsed >= DEADLINE_MILLIS) {
            throw new UpdatePorts.Failure("timeout", "The update transfer timed out.");
        }
        return DEADLINE_MILLIS - elapsed;
    }

    private static long contentLength(HttpsURLConnection connection) throws UpdatePorts.Failure {
        String text = connection.getHeaderField("Content-Length");
        if (text == null) return -1;
        Long length = nonnegative(text);
        if (length == null) throw transferFailure();
        return length;
    }

    private static String header(HttpsURLConnection connection, String name) {
        String value = connection.getHeaderField(name);
        return value != null && value.length() <= 512 ? value : null;
    }

    /** Kept at the HTTP boundary; scheduling consumes only the resulting typed failure deadline. */
    static Long retryDeadline(String retryAfter, String rateLimitReset, long now) {
        Long retry = null, reset = null;
        if (now < 0) return null;
        if (retryAfter != null && retryAfter.length() <= 512) {
            retryAfter = retryAfter.trim();
            Long seconds = nonnegative(retryAfter);
            try {
                if (seconds != null) retry = Math.addExact(now, Math.multiplyExact(seconds, 1000));
                else retry = ZonedDateTime.parse(retryAfter, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli();
            } catch (ArithmeticException | DateTimeParseException ignored) { /* Malformed or overflowing header. */ }
        }
        Long seconds = nonnegative(rateLimitReset);
        if (seconds != null) {
            try { reset = Math.multiplyExact(seconds, 1000); }
            catch (ArithmeticException ignored) { /* Overflowing timestamp. */ }
        }
        if (retry != null && retry <= now) retry = null;
        if (reset != null && reset <= now) reset = null;
        if (retry == null) return reset;
        if (reset == null) return retry;
        return Math.max(retry, reset);
    }

    private static Long nonnegative(String value) {
        if (value == null || value.length() > 512) return null;
        value = value.trim();
        if (value.length() > 19 || !value.matches("[0-9]+")) return null;
        try { return Long.parseLong(value); } catch (NumberFormatException ignored) { return null; }
    }

    static MessageDigest sha256() {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException impossible) { throw new AssertionError(impossible); }
    }

    static String hex(byte[] bytes) {
        char[] alphabet = "0123456789abcdef".toCharArray();
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(alphabet[(value & 255) >>> 4]).append(alphabet[value & 15]);
        return result.toString();
    }

    private static UpdatePorts.Failure transferFailure() {
        return new UpdatePorts.Failure("transfer_failed", "The update could not be transferred safely.");
    }

    private static final class Transfer {
        final int status;
        final String retryAfter, rateLimitReset;
        final long wall;
        String digest;
        Transfer(int status, String retryAfter, String rateLimitReset, long wall) {
            this.status = status; this.retryAfter = retryAfter; this.rateLimitReset = rateLimitReset; this.wall = wall;
        }
        Response response(byte[] bytes) { return new Response(bytes, status, retryAfter, rateLimitReset, wall); }
    }

    private static final class Resources implements Closeable {
        private final HttpsURLConnection connection;
        private final AtomicBoolean closed = new AtomicBoolean();
        private volatile InputStream input;
        Resources(HttpsURLConnection connection) { this.connection = connection; }
        void attach(InputStream stream) throws IOException {
            input = stream;
            if (closed.get()) stream.close();
        }
        public void close() {
            if (!closed.compareAndSet(false, true)) return;
            try { connection.disconnect(); }
            finally {
                InputStream stream = input;
                if (stream != null) try { stream.close(); } catch (IOException ignored) { /* Already disconnected. */ }
            }
        }
    }
}
