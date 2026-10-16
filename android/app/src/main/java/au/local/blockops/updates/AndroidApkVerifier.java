package au.local.blockops.updates;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import static au.local.blockops.updates.UpdateModel.*;

/** Uses the platform archive parser and current signer set, after rehashing private bytes. */
public final class AndroidApkVerifier implements UpdatePorts.Verifier {
    private final PackageManager packages;

    public AndroidApkVerifier(Context context) { packages = context.getApplicationContext().getPackageManager(); }

    /** Read the current installed signer, then apply the separate packaging pin. Never infer it. */
    public static InstalledApp readInstalled(Context context) throws UpdatePorts.Failure {
        try {
            int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
            return decodeInstalled(context.getPackageManager().getPackageInfo(context.getPackageName(), flags), Build.VERSION.SDK_INT);
        } catch (PackageManager.NameNotFoundException | RuntimeException failure) {
            throw invalidInstalled();
        }
    }

    // Package-private decoding seam exercises legacy/current signer APIs without replacing production identity.
    static InstalledApp decodeInstalled(PackageInfo info, int sdk) throws UpdatePorts.Failure {
        try {
            if (info == null || !UpdatePolicy.PACKAGE_NAME.equals(info.packageName)) throw invalidInstalled();
            if (sdk >= 28 && Build.VERSION.SDK_INT < 28) throw invalidInstalled();
            UpdatePolicy.parseVersion(info.versionName, false);
            long code = sdk >= 28 && Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
            String signer = currentSigner(info, sdk);
            if (code <= 0 || !UpdatePolicy.SIGNER_SHA256.equals(signer)) throw invalidInstalled();
            return new InstalledApp(info.packageName, info.versionName, code, signer, sdk);
        } catch (RuntimeException | UpdatePorts.Failure failure) {
            throw invalidInstalled();
        }
    }

    private static String currentSigner(PackageInfo info, int sdk) throws UpdatePorts.Failure {
        if (sdk >= 28 && Build.VERSION.SDK_INT < 28) throw invalidApk();
        Signature[] signers = sdk >= 28 && Build.VERSION.SDK_INT >= 28
                ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
        if (signers == null || signers.length != 1 || signers[0] == null) throw invalidApk();
        return HttpsUpdateTransport.hex(HttpsUpdateTransport.sha256().digest(signers[0].toByteArray()));
    }

    @Override public ApkIdentity inspect(Candidate candidate, InstalledApp installed) throws UpdatePorts.Failure {
        UpdateCandidateStore.verifyBytes(candidate);
        try {
            int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
            PackageInfo info = packages.getPackageArchiveInfo(candidate.file.getAbsolutePath(), flags);
            if (info == null || info.applicationInfo == null) throw invalidApk();
            String signer = currentSigner(info, Build.VERSION.SDK_INT);
            long versionCode = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
            ApkIdentity identity = new ApkIdentity(info.packageName, info.versionName, versionCode,
                    signer, info.applicationInfo.minSdkVersion);
            UpdatePolicy.requireIdentity(candidate.release, installed, identity);
            return identity;
        } catch (RuntimeException failure) {
            throw invalidApk();
        }
    }

    private static UpdatePorts.Failure invalidApk() {
        return new UpdatePorts.Failure("invalid_identity", "The APK cannot safely upgrade this app.");
    }
    private static UpdatePorts.Failure invalidInstalled() {
        return new UpdatePorts.Failure("installed_identity", "Updates are unavailable because this app's installed identity could not be verified.");
    }
}
