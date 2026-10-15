package au.local.blockops.updates;

import java.util.function.Consumer;
import static au.local.blockops.updates.UpdateModel.*;

/** Explicit side effects; implementations must report fixed, user-safe errors. */
public final class UpdatePorts {
    private UpdatePorts() {}

    public static final class Failure extends Exception {
        public final String code, message;
        public final Long serverRetryUntilWallMillis;

        public Failure(String code, String message) { this(code, message, null); }

        public Failure(String code, String message, Long serverRetryUntilWallMillis) {
            super(UpdateModel.plainText(message, 240));
            this.code = code != null && code.matches("[a-z][a-z0-9_]{0,63}") ? code : "update_failed";
            this.message = getMessage();
            this.serverRetryUntilWallMillis = serverRetryUntilWallMillis;
        }
    }

    public interface Clock { long wallMillis(); long elapsedMillis(); }
    public interface ReleaseSource { Release latest(UpdateCancellation cancellation) throws Failure; }
    public interface Downloader {
        Candidate download(Release release, UpdateCancellation cancellation, Progress progress) throws Failure;
    }
    public interface Progress { void onBytes(long downloadedBytes, long totalBytes); }
    public interface Verifier { ApkIdentity inspect(Candidate candidate, InstalledApp installed) throws Failure; }
    public interface StateStore { SavedState load() throws Failure; void save(SavedState state) throws Failure; }
    public interface SessionStore { Integer get() throws Failure; void set(Integer sessionId) throws Failure; }
    public interface CandidateStore extends Downloader {
        Candidate load() throws Failure;
        void deletePartial() throws Failure;
        void forget() throws Failure;
    }
    public interface Installer {
        boolean allowed() throws Failure;
        void openPermissionSettings() throws Failure;
        int commit(Candidate candidate) throws Failure;
        void confirm(int sessionId) throws Failure;
        InstallEvent reconcile(Integer sessionId) throws Failure;
        void cancelOwned(int sessionId) throws Failure;
        void setListener(Consumer<InstallEvent> listener) throws Failure;
    }
    public interface Listener { void onState(Snapshot state); }
}
