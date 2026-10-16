package au.local.blockops.updates;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Explicit, nonexported status endpoint. Application construction must not launch any UI. */
public final class UpdateInstallReceiver extends BroadcastReceiver {
    public interface Provider {
        AndroidUpdateInstaller updateInstaller();
    }

    @Override public void onReceive(Context context, Intent intent) {
        Context application = context.getApplicationContext();
        if (!(application instanceof Provider)) return;
        try {
            AndroidUpdateInstaller installer = ((Provider) application).updateInstaller();
            if (installer != null) installer.handleStatus(intent);
        } catch (UpdatePorts.Failure | RuntimeException ignored) {
            // Preserve the durable session on failure; foreground recovery can reconcile it.
        }
    }
}
