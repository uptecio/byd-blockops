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

    @Override public ApkIdentity inspect(Candidate candidate, InstalledApp installed) throws UpdatePorts.Failure {
        UpdateCandidateStore.verifyBytes(candidate);
        try {
            int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
            PackageInfo info = packages.getPackageArchiveInfo(candidate.file.getAbsolutePath(), flags);
            if (info == null || info.applicationInfo == null) throw invalidApk();
            Signature[] signers;
            if (Build.VERSION.SDK_INT >= 28) {
                if (info.signingInfo == null) throw invalidApk();
                signers = info.signingInfo.getApkContentsSigners();
            } else {
                signers = info.signatures;
            }
            if (signers == null || signers.length != 1 || signers[0] == null) throw invalidApk();
            String signer = HttpsUpdateTransport.hex(HttpsUpdateTransport.sha256().digest(signers[0].toByteArray()));
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
}
