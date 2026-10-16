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
            String suite=arguments.getString("suite");
            if (!"installer".equals(suite)&&!"controller".equals(suite)) throw new AssertionError("Unknown suite");
            UpdaterAndroidTest tests=new UpdaterAndroidTest(this);tests.run();
            if("controller".equals(suite))tests.controller();
            result.putString("stream", "PASS "+suite+"\n");
            finish(-1, result);
        } catch (Throwable failure) {
            result.putString("stream", "FAIL "+arguments.getString("suite")+": " + android.util.Log.getStackTraceString(failure));
            finish(0, result);
        }
    }
    void passed(String name) {
        Bundle result = new Bundle();
        result.putString("stream", "PASS " + name + "\n");
        sendStatus(0, result);
    }
}
