package au.local.blockops.updates;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Objects;
import java.util.function.Consumer;
import java.util.function.Supplier;
import static au.local.blockops.updates.UpdateModel.*;
import static au.local.blockops.updates.UpdatePorts.*;

/** Owns only this updater's recorded PackageInstaller session. Never launches from a callback. */
public final class AndroidUpdateInstaller implements Installer {
    static final String ACTION = "au.local.blockops.UPDATE_INSTALL_STATUS";
    private final Context context;
    private final SessionStore store;
    private final Supplier<Activity> foreground;
    private final InstalledApp installed;
    private final Verifier verifier;
    private final Platform platform;
    private Consumer<InstallEvent> listener = event -> {};
    private Intent pending;
    private Integer pendingSession;
    private boolean removalInProgress;

    /** Supplier returns a live Activity only while foreground Home consent is eligible. */
    public AndroidUpdateInstaller(Context context, SessionStore store, Supplier<Activity> foreground,
            InstalledApp installed, Verifier verifier) {
        this(context, store, foreground, installed, verifier, new NativePlatform(context));
    }

    AndroidUpdateInstaller(Context context, SessionStore store, Supplier<Activity> foreground,
            InstalledApp installed, Verifier verifier, Platform platform) {
        this.context = context.getApplicationContext();
        this.store = Objects.requireNonNull(store);
        this.foreground = Objects.requireNonNull(foreground);
        this.installed = Objects.requireNonNull(installed);
        this.verifier = Objects.requireNonNull(verifier);
        this.platform = Objects.requireNonNull(platform);
    }

    @Override public synchronized boolean allowed() throws Failure {
        try { return platform.allowed(); } catch (RuntimeException failure) { throw failed(); }
    }

    /** Called only by a native user tap; returning from Settings has no submission side effect. */
    @Override public synchronized void openPermissionSettings() throws Failure {
        requireNoRemoval();
        Activity activity = requireForeground();
        forgetConfirmation();
        try {
            platform.launch(activity, new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + context.getPackageName())));
        } catch (RuntimeException failure) { throw failed(); }
    }

    @Override public synchronized int commit(Candidate candidate) throws Failure {
        requireNoRemoval();
        Activity activity = requireForeground();
        if (store.get() != null) throw new Failure("install_pending", "An installation is pending. Cancel it before trying again.");
        if (!allowed()) throw new Failure("install_permission", "Allow this app to install updates, then tap Install again.");
        Integer created = null;
        boolean submissionStarted = false;
        try {
            requireInstalledUnchanged();
            verifier.inspect(candidate, installed);
            created = platform.create(candidate.release.asset.size);
            // A synchronous durable SessionStore write must finish before any submission.
            store.set(created);
            platform.write(created, candidate);
            verifier.inspect(candidate, installed);
            requireInstalledUnchanged();
            if (requireForeground() != activity || !allowed()) throw new Failure("install_interrupted", "Return Home and tap Install again.");
            Intent callback = new Intent(context, UpdateInstallReceiver.class).setAction(ACTION)
                    .setData(sessionUri(created));
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
            PendingIntent status = PendingIntent.getBroadcast(context, created, callback, flags);
            submissionStarted = true;
            platform.submit(created, status.getIntentSender());
            return created;
        } catch (Failure failure) {
            if (!submissionStarted) abandonUnsubmitted(created);
            throw failure;
        } catch (IOException | RuntimeException failure) {
            // Once submit has been entered its outcome may be uncertain. Preserve ownership.
            if (!submissionStarted) abandonUnsubmitted(created);
            throw failed();
        }
    }

    /** Native explicit continuation only. Pending Intent objects never enter persistent storage. */
    @Override public synchronized void confirm(int sessionId) throws Failure {
        requireNoRemoval();
        Activity activity = requireForeground();
        requireRecorded(sessionId);
        if (pending == null || pendingSession == null || pendingSession != sessionId) {
            throw new Failure("install_pending", "Installation is pending. Cancel it to start a fresh attempt.");
        }
        Intent confirmation = pending;
        forgetConfirmation();
        try { platform.launch(activity, confirmation); } catch (RuntimeException failure) { throw failed(); }
    }

    @Override public synchronized InstallEvent reconcile(Integer sessionId) throws Failure {
        requireNoRemoval();
        Integer recorded = store.get();
        if (recorded == null || (sessionId != null && !recorded.equals(sessionId))) return new InstallEvent(-1, "idle", "");
        try {
            long currentCode = platform.installedCode();
            SessionState session = platform.session(recorded);
            if (session == null) {
                store.set(null); forgetConfirmation();
                return new InstallEvent(recorded, "idle", "Check for updates to see the installed version.");
            }
            if (!session.sealed) {
                abandonAndVerify(recorded, true);
                store.set(null); forgetConfirmation();
                return new InstallEvent(recorded, "idle", "The unfinished installation was cancelled. You can try again.");
            }
            // A fresh process cannot distinguish success from cancellation using just a session ID.
            // Sealed sessions remain blocked even when the installed version has changed.
            String message = currentCode > installed.versionCode
                    ? "The installed app changed. Wait for the pending installation or cancel it."
                    : "An installation is pending. Wait for Android or cancel it before trying again.";
            return new InstallEvent(recorded, "installing", message);
        } catch (RuntimeException failure) { throw failed(); }
    }

    @Override public synchronized void cancelOwned(int sessionId) throws Failure {
        requireNoRemoval();
        requireRecorded(sessionId);
        try {
            abandonAndVerify(sessionId, true);
            store.set(null); forgetConfirmation();
        } catch (RuntimeException failure) { throw failed(); }
    }

    @Override public synchronized void setListener(Consumer<InstallEvent> listener) {
        this.listener = Objects.requireNonNull(listener);
    }

    /** Receiver entry point; wrong/late callbacks cannot change a different recorded session. */
    synchronized void handleStatus(Intent intent) throws Failure {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        Integer recorded = store.get();
        if (recorded == null || intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1) != recorded
                || !sessionUri(recorded).equals(intent.getData()) || !intent.hasExtra(PackageInstaller.EXTRA_STATUS)) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmation = Build.VERSION.SDK_INT >= 33
                    ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class)
                    : intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmation == null) {
                listener.accept(new InstallEvent(recorded, "installing", "Installation is pending. Cancel it to try again."));
                return;
            }
            pending = new Intent(confirmation);
            pendingSession = recorded;
            listener.accept(new InstallEvent(recorded, "confirmation", "Android requires your confirmation to install the update."));
            return;
        }
        store.set(null); forgetConfirmation();
        listener.accept(new InstallEvent(recorded, status == PackageInstaller.STATUS_SUCCESS ? "idle" : "error", terminalMessage(status)));
    }

    private Activity requireForeground() throws Failure {
        Activity activity = foreground.get();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            throw new Failure("not_foreground", "Return to Home before installing the update.");
        }
        return activity;
    }
    private void requireInstalledUnchanged() throws Failure {
        if (platform.installedCode() != installed.versionCode) throw new Failure("installed_changed", "The installed app changed. Check for updates again.");
    }
    private void requireRecorded(int sessionId) throws Failure {
        Integer recorded = store.get();
        if (recorded == null || recorded != sessionId) throw new Failure("wrong_session", "This installation is no longer pending.");
    }
    private void abandonUnsubmitted(Integer created) throws Failure {
        if (created == null) return;
        try {
            SessionState state = platform.session(created);
            if (state != null && state.sealed) return;
            abandonAndVerify(created, created.equals(store.get()));
            if (created.equals(store.get())) store.set(null);
            forgetConfirmation();
        } catch (RuntimeException failure) { throw failed(); }
    }
    /** Android removes sessions asynchronously. Only the worker waits, without holding this monitor. */
    private void abandonAndVerify(int id, boolean recorded) throws Failure {
        if (Looper.myLooper() == Looper.getMainLooper()) throw failed();
        requireNoRemoval();
        removalInProgress = true;
        try {
            if (recorded) requireRecorded(id);
            if (platform.session(id) != null) platform.abandon(id);
            long started = SystemClock.elapsedRealtime();
            while (true) {
                if (recorded) {
                    Integer owner = store.get();
                    // A legitimate terminal callback may clear this ID while the monitor is
                    // released. Still verify absence; a different ID always stops this cleanup.
                    if (owner != null && owner != id) throw new Failure("wrong_session", "This installation is no longer pending.");
                }
                if (platform.session(id) == null) return;
                long remaining = 2000 - (SystemClock.elapsedRealtime() - started);
                if (remaining <= 0) throw failed();
                try {
                    // Release the monitor so the UI receiver can record a result. Mutating operations
                    // remain serialized by removalInProgress; ownership is checked after each wake.
                    wait(Math.min(25, remaining));
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw failed();
                }
            }
        } finally { removalInProgress = false; }
    }
    private void requireNoRemoval() throws Failure {
        if (removalInProgress) throw new Failure("install_pending", "Installation cleanup is pending. Please wait.");
    }
    private void forgetConfirmation() { pending = null; pendingSession = null; }
    private static Uri sessionUri(int sessionId) { return Uri.parse("blockops-update:" + sessionId); }
    private static Failure failed() { return new Failure("install_failed", "Android could not finish the installation. Check its status or try again."); }
    private static String terminalMessage(int status) {
        switch (status) {
            case PackageInstaller.STATUS_SUCCESS: return "The update was installed.";
            case PackageInstaller.STATUS_FAILURE_ABORTED: return "Installation was cancelled. You can try again.";
            case PackageInstaller.STATUS_FAILURE_BLOCKED: return "Android blocked installation. Check your device settings.";
            case PackageInstaller.STATUS_FAILURE_CONFLICT: return "The update conflicts with the installed app.";
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE: return "The update is not compatible with this device.";
            case PackageInstaller.STATUS_FAILURE_INVALID: return "Android rejected the update file. Download it again.";
            case PackageInstaller.STATUS_FAILURE_STORAGE: return "There is not enough storage to install the update.";
            default: return "Android could not install the update. You can try again.";
        }
    }

    static final class SessionState {
        final boolean sealed;
        SessionState(boolean sealed) { this.sealed = sealed; }
    }
    interface Platform {
        boolean allowed();
        int create(long size) throws IOException;
        void write(int id, Candidate candidate) throws IOException, Failure;
        void submit(int id, IntentSender sender) throws IOException;
        SessionState session(int id);
        void abandon(int id);
        long installedCode() throws Failure;
        void launch(Activity activity, Intent intent);
    }
    static final class NativePlatform implements Platform {
        private final Context context;
        private final PackageInstaller packages;
        NativePlatform(Context context) {
            this.context = context.getApplicationContext();
            packages = this.context.getPackageManager().getPackageInstaller();
        }
        public boolean allowed() { return context.getPackageManager().canRequestPackageInstalls(); }
        public int create(long size) throws IOException {
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(context.getPackageName());
            params.setSize(size);
            if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
            return packages.createSession(params);
        }
        public void write(int id, Candidate candidate) throws IOException, Failure {
            MessageDigest digest = HttpsUpdateTransport.sha256();
            try (PackageInstaller.Session session = packages.openSession(id);
                    InputStream in = new FileInputStream(candidate.file);
                    OutputStream out = session.openWrite("base.apk", 0, candidate.release.asset.size)) {
                byte[] buffer = new byte[32768]; long count = 0; int read;
                while ((read = in.read(buffer)) != -1) {
                    count += read;
                    if (count > candidate.release.asset.size) throw failed();
                    digest.update(buffer, 0, read); out.write(buffer, 0, read);
                }
                if (count != candidate.release.asset.size || !HttpsUpdateTransport.hex(digest.digest()).equals(candidate.release.sha256)) throw failed();
                session.fsync(out);
            }
        }
        public void submit(int id, IntentSender sender) throws IOException {
            try (PackageInstaller.Session session = packages.openSession(id)) { session.commit(sender); }
        }
        public SessionState session(int id) {
            for (PackageInstaller.SessionInfo info : packages.getMySessions()) {
                if (info.getSessionId() == id && context.getPackageName().equals(info.getInstallerPackageName())
                        && context.getPackageName().equals(info.getAppPackageName())) return new SessionState(info.isSealed());
            }
            return null;
        }
        public void abandon(int id) { packages.abandonSession(id); }
        public long installedCode() throws Failure {
            try {
                PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
                return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
            } catch (android.content.pm.PackageManager.NameNotFoundException failure) { throw failed(); }
        }
        public void launch(Activity activity, Intent intent) { activity.startActivity(intent); }
    }
}
