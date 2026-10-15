package au.local.blockops.updates;

import android.app.Instrumentation;
import android.os.Bundle;

/** No test entry point is included in the production APK. */
public final class UpdaterInstrumentation extends Instrumentation {
    private Bundle arguments;
    @Override public void onCreate(Bundle arguments) {
        this.arguments = arguments;
        start();
    }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            if (!"installer".equals(arguments.getString("suite"))) throw new AssertionError("Unknown suite");
            new UpdaterAndroidTest(this).run();
            result.putString("stream", "PASS installer\n");
            finish(-1, result);
        } catch (Throwable failure) {
            result.putString("stream", "FAIL installer: " + android.util.Log.getStackTraceString(failure));
            finish(0, result);
        }
    }
    void passed(String name) {
        Bundle result = new Bundle();
        result.putString("stream", "PASS " + name + "\n");
        sendStatus(0, result);
    }
}
