package au.local.blockops.updates;

import java.io.Closeable;
import java.io.IOException;
import java.net.URI;
import java.util.Arrays;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static au.local.blockops.updates.UpdateModel.*;

public final class UpdaterPolicyTest {
    private static final String SIGNER = "6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49";
    private static final String HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private static final String NAME = "block-ops-0.11.0.apk";
    private static final String URL = "https://github.com/uptecio/byd-blockops/releases/download/v0.11.0/" + NAME;

    public static void main(String[] args) throws Exception {
        numericVersions();
        stableAssetSelection();
        exactRepositoryAndHost();
        digestFallback();
        identityGate();
        cancellationRegistration();
        boundedPublicState();
        System.out.println("PASS policy");
    }

    // Catches lexicographic comparison, permissive tags and integer wraparound.
    private static void numericVersions() {
        assert UpdatePolicy.compare(UpdatePolicy.parseVersion("v0.11.0", true),
                UpdatePolicy.parseVersion("0.10.0", false)) > 0;
        assert UpdatePolicy.compare(UpdatePolicy.parseVersion("v0.9.99", true),
                UpdatePolicy.parseVersion("0.10.0", false)) < 0;
        assert UpdatePolicy.compare(UpdatePolicy.parseVersion("v1.0.0", true),
                UpdatePolicy.parseVersion("0.99.99", false)) > 0;
        assert UpdatePolicy.compare(UpdatePolicy.parseVersion("v0.11.1", true),
                UpdatePolicy.parseVersion("0.11.0", false)) > 0;
        assert UpdatePolicy.compare(UpdatePolicy.parseVersion("v1.0.0", true),
                UpdatePolicy.parseVersion("1.0.0", false)) == 0;
        assert UpdatePolicy.parseVersion("2147483647.0.0", false).major == Integer.MAX_VALUE;
        for (String invalid : new String[] {"v0.11.0-beta", "v01.11.0", "v0.011.0", "v0.11.00",
                "v2147483648.0.0", "v0.2147483648.0", "v0.0.2147483648", "v-1.0.0", "v0.11",
                "v0.11.0\n", " v0.11.0", "v0.11.0+build", "0.11.0", "V0.11.0", null}) {
            expectRejected(() -> UpdatePolicy.parseVersion(invalid, true));
        }
        expectRejected(() -> UpdatePolicy.parseVersion("v0.11.0", false));
    }

    // Catches unstable releases, duplicate artifacts and unbounded/foreign asset selection.
    private static void stableAssetSelection() {
        Asset apk = asset(NAME, URL, 1024);
        Asset sums = asset("SHA256SUMS", URL.replace(NAME, "SHA256SUMS"), 512);
        assert UpdatePolicy.select("v0.11.0", false, false, Arrays.asList(sums, apk)) == apk;
        assert UpdatePolicy.select("v0.11.0", false, false,
                Collections.singletonList(asset(NAME, URL, 100L * 1024 * 1024))).size == 104857600;
        expectRejected(() -> UpdatePolicy.select("v0.11.0", true, false, Arrays.asList(apk)));
        expectRejected(() -> UpdatePolicy.select("v0.11.0", false, true, Arrays.asList(apk)));
        expectRejected(() -> UpdatePolicy.select("v0.11.0-beta", false, false, Arrays.asList(apk)));
        expectRejected(() -> UpdatePolicy.select("v0.11.0", false, false, Arrays.asList(apk, apk)));
        expectRejected(() -> UpdatePolicy.select("v0.11.0", false, false, Arrays.asList(apk,
                asset("block-ops-other.apk", URL.replace(NAME, "block-ops-other.apk"), 1024))));
        expectRejected(() -> UpdatePolicy.select("v0.11.0", false, false, Arrays.asList(sums)));
        expectRejected(() -> UpdatePolicy.select("v0.11.0", false, false,
                Arrays.asList(asset(NAME, URL, 0))));
        expectRejected(() -> UpdatePolicy.select("v0.11.0", false, false,
                Arrays.asList(asset(NAME, URL, 104857601))));
        expectRejected(() -> UpdatePolicy.select("v0.11.0", false, false,
                Arrays.asList(asset(NAME, URL.replace("uptecio", "foreign"), 1024))));
        expectRejected(() -> UpdatePolicy.select("v0.11.0", false, false,
                Arrays.asList(asset(NAME, URL.replace(NAME, "block-ops-other.apk"), 1024))));
    }

    // Catches authority confusion, alternate encoded paths and excessive redirect chains.
    private static void exactRepositoryAndHost() {
        UpdatePolicy.requireInitialAssetUri(URI.create(URL), "v0.11.0", NAME);
        UpdatePolicy.requireInitialAssetUri(URI.create(URL.replace(NAME, "SHA256SUMS")), "v0.11.0", "SHA256SUMS");
        for (String host : new String[] {"api.github.com", "github.com", "release-assets.githubusercontent.com",
                "objects.githubusercontent.com"}) {
            UpdatePolicy.requireRedirectUri(URI.create("https://" + host + "/file.apk?signature=ok"), 5);
        }
        expectRejected(() -> UpdatePolicy.requireRedirectUri(URI.create("https://github.com.evil.test/file.apk"), 1));
        expectRejected(() -> UpdatePolicy.requireRedirectUri(URI.create("http://github.com/file.apk"), 1));
        for (String invalid : new String[] {"https://user@github.com/file.apk", "https://github.com/file.apk#fragment",
                "https://github.com:444/file.apk", "https://github.com/%2e%2e/file.apk",
                "https://github.com/a%2fb.apk", "https://github.com/a%2Fb.apk", "https://github.com/%2E%2E/file.apk",
                "https://github.com/a%5cb.apk", "https://github.com/%252e/file.apk",
                "https://github.com/../file.apk", "//github.com/file.apk", "https://evil.test/file.apk"}) {
            expectRejected(() -> UpdatePolicy.requireRedirectUri(URI.create(invalid), 1));
        }
        expectRejected(() -> UpdatePolicy.requireRedirectUri(URI.create(URL), 6));
        for (String invalid : new String[] {URL.replace("uptecio", "another"), URL.replace("byd-blockops", "other"),
                URL.replace("v0.11.0", "v0.10.0"), URL + "/extra", URL + "#fragment", URL + "?download=1",
                URL.replace("block-ops-", "block%2dops-"), URL.replace("/v0.11.0/", "/v0.11.0%2f/"),
                URL.replace("github.com", "objects.githubusercontent.com")}) {
            expectRejected(() -> UpdatePolicy.requireInitialAssetUri(URI.create(invalid), "v0.11.0", NAME));
        }
    }

    // Catches fallback after a bad API digest, substring filename matches and duplicate rows.
    private static void digestFallback() {
        assert UpdatePolicy.digest("sha256:" + HASH.toUpperCase(), null, NAME).equals(HASH);
        assert UpdatePolicy.digest(null, HASH + "  " + NAME + "\n", NAME).equals(HASH);
        assert UpdatePolicy.digest(null, HASH + " *" + NAME + "\r\n", NAME).equals(HASH);
        assert UpdatePolicy.digest(null, HASH + "  other.apk\n" + HASH + "  " + NAME, NAME).equals(HASH);
        expectRejected(() -> UpdatePolicy.digest("sha256:bad", HASH + "  " + NAME, NAME));
        expectRejected(() -> UpdatePolicy.digest("", HASH + "  " + NAME, NAME));
        expectRejected(() -> UpdatePolicy.digest("md5:" + HASH, null, NAME));
        expectRejected(() -> UpdatePolicy.digest(null, HASH + "  " + NAME + ".old", NAME));
        expectRejected(() -> UpdatePolicy.digest(null, HASH + "  ./" + NAME, NAME));
        expectRejected(() -> UpdatePolicy.digest(null, HASH + "  " + NAME + "\n" + HASH + " *" + NAME, NAME));
        expectRejected(() -> UpdatePolicy.digest(null, "bad  " + NAME, NAME));
        expectRejected(() -> UpdatePolicy.digest(null, null, NAME));
        // The transport limit is bytes, including non-ASCII checksum filenames.
        expectRejected(() -> UpdatePolicy.digest(null,
                HASH + "  " + "é".repeat(300000) + "\n" + HASH + "  " + NAME, NAME));
    }

    // Catches package/signer substitution, downgrade installs and unsupported platform requirements.
    private static void identityGate() {
        Release release = new Release(10, "v0.11.0", UpdatePolicy.parseVersion("v0.11.0", true),
                asset(NAME, URL, 1024), HASH, "Update");
        InstalledApp installed = new InstalledApp("au.local.blockops", "0.10.0", 14, SIGNER, 26);
        UpdatePolicy.requireIdentity(release, installed, identity("au.local.blockops", "0.11.0", 15, SIGNER, 26));
        expectRejected(() -> UpdatePolicy.requireIdentity(release, installed, identity("evil.app", "0.11.0", 15, SIGNER, 26)));
        expectRejected(() -> UpdatePolicy.requireIdentity(release, installed, identity("au.local.blockops", "0.11.0", 15, HASH, 26)));
        expectRejected(() -> UpdatePolicy.requireIdentity(release, installed, identity("au.local.blockops", "0.11.0", 14, SIGNER, 26)));
        expectRejected(() -> UpdatePolicy.requireIdentity(release, installed, identity("au.local.blockops", "0.11.0", 13, SIGNER, 26)));
        expectRejected(() -> UpdatePolicy.requireIdentity(release, installed, identity("au.local.blockops", "0.11.0", 15, SIGNER, 27)));
        expectRejected(() -> UpdatePolicy.requireIdentity(release, installed, identity("au.local.blockops", "0.11.0", 15, SIGNER, 0)));
        expectRejected(() -> UpdatePolicy.requireIdentity(release, installed, identity("au.local.blockops", "0.12.0", 15, SIGNER, 26)));
        expectRejected(() -> UpdatePolicy.requireIdentity(release,
                new InstalledApp("au.local.blockops", "0.12.0", 14, SIGNER, 26),
                identity("au.local.blockops", "0.11.0", 15, SIGNER, 26)));
        expectRejected(() -> UpdatePolicy.requireIdentity(release,
                new InstalledApp("au.local.blockops", "0.10.0", 14, HASH, 26),
                identity("au.local.blockops", "0.11.0", 15, HASH, 26)));
        expectRejected(() -> UpdatePolicy.requireIdentity(release,
                new InstalledApp("other.app", "0.10.0", 14, SIGNER, 26),
                identity("au.local.blockops", "0.11.0", 15, SIGNER, 26)));
    }

    // Catches cancellation that misses late resources, repeats teardown or stops after a close failure.
    private static void cancellationRegistration() throws Exception {
        UpdateCancellation cancellation = new UpdateCancellation();
        AtomicInteger closed = new AtomicInteger();
        Closeable resource = () -> closed.incrementAndGet();
        cancellation.check();
        cancellation.register(() -> { throw new IOException("test failure"); });
        cancellation.register(() -> { throw new IllegalStateException("test failure"); });
        cancellation.register(resource);
        cancellation.cancel();
        assert closed.get() == 1;
        cancellation.cancel();
        assert closed.get() == 1;
        cancellation.register(resource);
        assert closed.get() == 2;
        try {
            cancellation.check();
            throw new AssertionError("Cancelled work must fail");
        } catch (UpdatePorts.Failure expected) {
            assert expected.code.equals("cancelled");
            assert expected.serverRetryUntilWallMillis == null;
        }
        UpdateCancellation inProgress = new UpdateCancellation();
        CountDownLatch closing = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        inProgress.register(() -> {
            closing.countDown();
            try {
                release.await();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IOException(interrupted);
            }
        });
        Thread cancellationThread = new Thread(inProgress::cancel);
        CountDownLatch registered = new CountDownLatch(1);
        Thread registrationThread = new Thread(() -> {
            inProgress.register(resource);
            registered.countDown();
        });
        cancellationThread.start();
        try {
            assert closing.await(5, TimeUnit.SECONDS);
            registrationThread.start();
            assert registered.await(1, TimeUnit.SECONDS) : "Late registration must not wait for pending teardown";
            assert closed.get() == 3 : "Late registration must close while earlier teardown is pending";
        } finally {
            release.countDown();
            cancellationThread.join(5000);
            registrationThread.join(5000);
        }
        assert !cancellationThread.isAlive();
        assert !registrationThread.isAlive();
    }

    // Catches raw unbounded/control-bearing text leaking through public state or typed failures.
    private static void boundedPublicState() {
        Snapshot snapshot = new Snapshot(1, "available", "0.10.0", "0.11.0", 1024, 0,
                "Ready\u0000\u202e" + "x".repeat(10000), false);
        assert snapshot.message.length() <= 240;
        assert snapshot.message.startsWith("Ready  ");
        assert snapshot.availableVersion.equals("0.11.0");
        Snapshot idle = new Snapshot(2, "idle", "0.10.0", null, 0, 0, null, false);
        assert idle.availableVersion == null;
        assert idle.message.equals("");
        UpdatePorts.Failure failure = new UpdatePorts.Failure("rate_limited", "Wait\n" + "x".repeat(10000), 12345L);
        assert failure.getMessage().length() <= 240;
        assert !failure.getMessage().contains("\n");
        assert failure.code.equals("rate_limited");
        assert failure.serverRetryUntilWallMillis == 12345L;
    }

    private static Asset asset(String name, String uri, long size) {
        return new Asset(1, name, URI.create(uri), size, "sha256:" + HASH);
    }

    private static ApkIdentity identity(String pkg, String version, long code, String signer, int minSdk) {
        return new ApkIdentity(pkg, version, code, signer, minSdk);
    }

    private static void expectRejected(Runnable operation) {
        try {
            operation.run();
        } catch (UpdatePolicy.PolicyFailure expected) {
            return;
        }
        throw new AssertionError("Expected policy rejection");
    }
}
