package au.local.blockops.updates;

import java.io.File;
import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Immutable values shared by the updater's policy, controller and platform ports. */
public final class UpdateModel {
    private UpdateModel() {}

    public static final class Version {
        public final int major, minor, patch;

        public Version(int major, int minor, int patch) {
            if (major < 0 || minor < 0 || patch < 0) throw new IllegalArgumentException("Invalid version");
            this.major = major;
            this.minor = minor;
            this.patch = patch;
        }

        @Override public String toString() { return major + "." + minor + "." + patch; }
    }

    public static final class Asset {
        public final long id, size;
        public final String name, digest;
        public final URI uri;

        public Asset(long id, String name, URI uri, long size, String digest) {
            this.id = id;
            this.name = name;
            this.uri = uri;
            this.size = size;
            this.digest = digest;
        }
    }

    public static final class Release {
        public final long id;
        public final String tag, sha256, summary;
        public final Version version;
        public final Asset asset;

        public Release(long id, String tag, Version version, Asset asset, String sha256, String summary) {
            this.id = id;
            this.tag = tag;
            this.version = version;
            this.asset = asset;
            this.sha256 = sha256;
            this.summary = plainText(summary, 1024);
        }
    }

    public static final class InstalledApp {
        public final String packageName, versionName, signerSha256;
        public final long versionCode;
        public final int sdkInt;

        public InstalledApp(String packageName, String versionName, long versionCode, String signerSha256, int sdkInt) {
            this.packageName = packageName;
            this.versionName = versionName;
            this.versionCode = versionCode;
            this.signerSha256 = signerSha256;
            this.sdkInt = sdkInt;
        }
    }

    public static final class ApkIdentity {
        public final String packageName, versionName, signerSha256;
        public final long versionCode;
        public final int minSdk;

        public ApkIdentity(String packageName, String versionName, long versionCode, String signerSha256, int minSdk) {
            this.packageName = packageName;
            this.versionName = versionName;
            this.versionCode = versionCode;
            this.signerSha256 = signerSha256;
            this.minSdk = minSdk;
        }
    }

    public static final class Candidate {
        public final File file;
        public final Release release;

        public Candidate(File file, Release release) { this.file = file; this.release = release; }
    }

    public static final class Snapshot {
        private static final Set<String> PHASES = new HashSet<>(Arrays.asList("idle", "checking", "current",
                "available", "downloading", "verifying", "ready", "permission", "installing", "error"));
        public final long revision, totalBytes, downloadedBytes;
        public final String phase, installedVersion, availableVersion, message;
        public final boolean dismissed;

        public Snapshot(long revision, String phase, String installedVersion, String availableVersion,
                long totalBytes, long downloadedBytes, String message, boolean dismissed) {
            if (!PHASES.contains(phase)) throw new IllegalArgumentException("Invalid updater phase");
            this.revision = revision;
            this.phase = phase;
            this.installedVersion = plainText(installedVersion, 64);
            this.availableVersion = availableVersion == null ? null : plainText(availableVersion, 64);
            this.totalBytes = totalBytes;
            this.downloadedBytes = downloadedBytes;
            this.message = plainText(message, 240);
            this.dismissed = dismissed;
        }
    }

    public static final class SavedState {
        public final long lastSuccessWallMillis, lastFailureWallMillis, serverRetryUntilWallMillis;
        public final Release cachedRelease;

        public SavedState(long lastSuccessWallMillis, long lastFailureWallMillis,
                long serverRetryUntilWallMillis, Release cachedRelease) {
            this.lastSuccessWallMillis = lastSuccessWallMillis;
            this.lastFailureWallMillis = lastFailureWallMillis;
            this.serverRetryUntilWallMillis = serverRetryUntilWallMillis;
            this.cachedRelease = cachedRelease;
        }
    }

    public static final class InstallEvent {
        public final int sessionId;
        public final String phase, message;

        public InstallEvent(int sessionId, String phase, String message) {
            this.sessionId = sessionId;
            this.phase = plainText(phase, 64);
            this.message = plainText(message, 240);
        }
    }

    static String plainText(String text, int maximum) {
        if (text == null) return "";
        StringBuilder safe = new StringBuilder();
        for (int i = 0; i < text.length() && safe.length() < maximum; i++) {
            char character = text.charAt(i);
            if (!Character.isISOControl(character) && Character.getType(character) != Character.FORMAT) {
                safe.append(character);
            } else {
                safe.append(' ');
            }
        }
        return safe.toString();
    }
}
