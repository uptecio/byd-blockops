package au.local.blockops.updates;

import java.io.*;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import static au.local.blockops.updates.UpdateModel.*;

/** Owns only generated updater files in an app-private directory supplied by the native factory. */
public final class UpdateCandidateStore implements UpdatePorts.CandidateStore {
    private final File directory, metadata;
    private final HttpsUpdateTransport transport;
    private long generation;
    private final Map<Long, UpdateCancellation> incomplete = new HashMap<>();

    public UpdateCandidateStore(File directory, HttpsUpdateTransport transport) {
        this.directory = java.util.Objects.requireNonNull(directory);
        this.metadata = new File(directory, "candidate.properties");
        this.transport = java.util.Objects.requireNonNull(transport);
    }

    @Override public Candidate download(Release release, UpdateCancellation token, UpdatePorts.Progress progress)
            throws UpdatePorts.Failure {
        validateRelease(release);
        token.check();
        final long operation;
        final List<UpdateCancellation> superseded;
        File partial = null, complete = null, metadataPartial = null;
        boolean promoted = false;
        synchronized (this) {
            operation = ++generation;
            superseded = new ArrayList<>(incomplete.values());
            incomplete.put(operation, token);
        }
        try {
            // Mark and close prior work before opening this generation's connection. Closing can block,
            // so retain every token and let later generations invalidate this waiting operation too.
            for (UpdateCancellation previous : superseded) previous.cancel();
            token.check();
            ensureDirectory();
            if (directory.getUsableSpace() < release.asset.size + UpdatePolicy.MAX_METADATA_BYTES) {
                throw new UpdatePorts.Failure("storage_full", "There is not enough space for the update.");
            }
            partial = File.createTempFile("transfer-", ".part", directory);
            try (FileOutputStream output = new FileOutputStream(partial)) {
                token.register(output);
                token.check();
                String digest = transport.copy(release.asset.uri, output, release.asset.size, token, (n, total) -> {
                    synchronized (this) {
                        if (operation == generation && progress != null) progress.onBytes(n, total);
                    }
                });
                if (!release.sha256.equalsIgnoreCase(digest)) throw integrityFailure();
                token.check();
                output.getFD().sync();
            }
            verifyBytes(new Candidate(partial, release));
            complete = new File(directory, "candidate-" + java.util.UUID.randomUUID() + ".apk");
            Properties properties = encode(release, complete.getName());
            metadataPartial = File.createTempFile("metadata-", ".part", directory);
            try (FileOutputStream output = new FileOutputStream(metadataPartial)) {
                properties.store(output, "Block Ops updater candidate");
                output.getFD().sync();
            }
            synchronized (this) {
                synchronized (token) {
                    token.check();
                    if (operation != generation) throw new UpdatePorts.Failure("cancelled", "Update cancelled.");
                    // APK names are generated locally. Metadata atomically selects one complete generation,
                    // so a crash never makes new metadata refer to the previous APK's bytes.
                    Files.move(partial.toPath(), complete.toPath(), StandardCopyOption.ATOMIC_MOVE);
                    Files.move(metadataPartial.toPath(), metadata.toPath(), StandardCopyOption.ATOMIC_MOVE,
                            StandardCopyOption.REPLACE_EXISTING);
                    promoted = true;
                    pruneCompleteExcept(complete);
                    return new Candidate(complete, release);
                }
            }
        } catch (IOException | IllegalArgumentException failure) {
            token.check();
            throw storageFailure();
        } finally {
            deleteOwned(partial);
            deleteOwned(metadataPartial);
            if (!promoted) deleteOwned(complete);
            synchronized (this) { incomplete.remove(operation); }
        }
    }

    @Override public synchronized Candidate load() throws UpdatePorts.Failure {
        if (!metadata.exists()) {
            if (hasCompleteFiles()) throw integrityFailure();
            return null;
        }
        try {
            if (!metadata.isFile() || metadata.length() > UpdatePolicy.MAX_METADATA_BYTES) throw integrityFailure();
            Properties properties = new Properties();
            // This is private local metadata, but corruption must not create an unbounded read.
            try (InputStream input = new FileInputStream(metadata)) {
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                int count, total = 0;
                while ((count = input.read(buffer, 0, Math.min(buffer.length,
                        (int) UpdatePolicy.MAX_METADATA_BYTES - total + 1))) != -1) {
                    total += count;
                    if (total > UpdatePolicy.MAX_METADATA_BYTES) throw integrityFailure();
                    bytes.write(buffer, 0, count);
                }
                properties.load(new ByteArrayInputStream(bytes.toByteArray()));
            }
            if (!"1".equals(required(properties, "schema"))) throw integrityFailure();
            String name = required(properties, "file");
            if (!isCompleteName(name)) throw integrityFailure();
            File file = new File(directory, name);
            if (!file.getCanonicalFile().getParentFile().equals(directory.getCanonicalFile())
                    || !file.getCanonicalFile().equals(file.getAbsoluteFile())) throw integrityFailure();
            String tag = required(properties, "tag");
            String digest = required(properties, "digest");
            Release release = new Release(number(properties, "releaseId"), tag, UpdatePolicy.parseVersion(tag, true),
                    new Asset(number(properties, "assetId"), required(properties, "name"),
                            URI.create(required(properties, "uri")), number(properties, "size"), digest.isEmpty() ? null : digest),
                    required(properties, "sha256"), required(properties, "summary"));
            validateRelease(release);
            Candidate candidate = new Candidate(file, release);
            verifyBytes(candidate);
            return candidate;
        } catch (IOException | IllegalArgumentException failure) {
            throw integrityFailure();
        }
    }

    @Override public void deletePartial() throws UpdatePorts.Failure {
        cleanup(false);
    }

    @Override public void forget() throws UpdatePorts.Failure {
        cleanup(true);
    }

    private void cleanup(boolean forgetComplete) throws UpdatePorts.Failure {
        List<UpdateCancellation> pending = new ArrayList<>();
        File[] files = null;
        try {
            synchronized (this) {
                ++generation;
                // Superseded generations still own sockets until their download finally block runs.
                pending.addAll(incomplete.values());
                files = directory.listFiles();
                // Complete-file deletion belongs to this generation, before teardown releases newer work.
                if (forgetComplete) {
                    if (!metadata.delete() && metadata.exists()) throw storageFailure();
                    pruneCompleteExcept(null);
                }
            }
        } finally {
            // Socket teardown can block. Never hold the store monitor, or discover newer files, here.
            for (UpdateCancellation token : pending) token.cancel();
            if (files != null) for (File file : files) {
                String name = file.getName();
                if ((name.startsWith("transfer-") || name.startsWith("metadata-")) && name.endsWith(".part")) {
                    if (!file.delete() && file.exists()) throw storageFailure();
                }
            }
        }
    }

    /** Re-read bytes every time a complete candidate is reused or passed to native APK inspection. */
    public static void verifyBytes(Candidate candidate) throws UpdatePorts.Failure {
        if (candidate == null || candidate.file == null) throw integrityFailure();
        validateRelease(candidate.release);
        File file = candidate.file;
        if (!file.isFile() || file.length() != candidate.release.asset.size) throw integrityFailure();
        try (InputStream input = new FileInputStream(file)) {
            MessageDigest digest = HttpsUpdateTransport.sha256();
            byte[] buffer = new byte[8192];
            long total = 0, size = candidate.release.asset.size;
            int count;
            while ((count = input.read(buffer, 0, (int) Math.min(buffer.length, size - total + 1))) != -1) {
                total += count;
                if (total > size) throw integrityFailure();
                digest.update(buffer, 0, count);
            }
            if (total != size || !candidate.release.sha256.equalsIgnoreCase(HttpsUpdateTransport.hex(digest.digest()))) {
                throw integrityFailure();
            }
        } catch (IOException failure) { throw integrityFailure(); }
    }

    private static void validateRelease(Release release) throws UpdatePorts.Failure {
        try {
            if (release == null || release.id <= 0 || release.version == null || release.sha256 == null
                    || !release.sha256.matches("[a-fA-F0-9]{64}")
                    || UpdatePolicy.compare(UpdatePolicy.parseVersion(release.tag, true), release.version) != 0) {
                throw integrityFailure();
            }
            UpdatePolicy.select(release.tag, false, false, java.util.Collections.singletonList(release.asset));
            if (release.asset.digest != null && !UpdatePolicy.digest(release.asset.digest, null, release.asset.name)
                    .equalsIgnoreCase(release.sha256)) throw integrityFailure();
        } catch (UpdatePolicy.PolicyFailure failure) { throw integrityFailure(); }
    }

    private void ensureDirectory() throws UpdatePorts.Failure {
        if ((!directory.isDirectory() && !directory.mkdirs()) || !directory.isDirectory()) throw storageFailure();
    }

    private static Properties encode(Release release, String filename) {
        Properties result = new Properties();
        result.setProperty("schema", "1"); result.setProperty("file", filename);
        result.setProperty("releaseId", Long.toString(release.id)); result.setProperty("tag", release.tag);
        result.setProperty("assetId", Long.toString(release.asset.id)); result.setProperty("name", release.asset.name);
        result.setProperty("uri", release.asset.uri.toASCIIString()); result.setProperty("size", Long.toString(release.asset.size));
        result.setProperty("digest", release.asset.digest == null ? "" : release.asset.digest);
        result.setProperty("sha256", release.sha256); result.setProperty("summary", release.summary);
        return result;
    }

    private static String required(Properties properties, String name) throws UpdatePorts.Failure {
        String value = properties.getProperty(name);
        if (value == null) throw integrityFailure();
        return value;
    }

    private static long number(Properties properties, String name) throws UpdatePorts.Failure {
        String value = required(properties, name);
        if (!value.matches("[1-9][0-9]{0,18}")) throw integrityFailure();
        return Long.parseLong(value);
    }

    private static boolean isCompleteName(String name) {
        return name.matches("candidate-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.apk");
    }

    private boolean hasCompleteFiles() {
        File[] files = directory.listFiles();
        if (files != null) for (File file : files) if (isCompleteName(file.getName())) return true;
        return false;
    }

    private void pruneCompleteExcept(File keep) throws UpdatePorts.Failure {
        File[] files = directory.listFiles();
        if (files == null) return;
        for (File file : files) if (isCompleteName(file.getName()) && !file.equals(keep)) {
            if (!file.delete() && file.exists()) throw storageFailure();
        }
    }

    private static void deleteOwned(File file) {
        if (file != null) file.delete(); // These exact paths were generated by this operation, never asset filenames.
    }

    private static UpdatePorts.Failure storageFailure() {
        return new UpdatePorts.Failure("storage_failed", "The private update file could not be saved.");
    }
    private static UpdatePorts.Failure integrityFailure() {
        return new UpdatePorts.Failure("invalid_candidate", "The update file failed integrity verification.");
    }
}
