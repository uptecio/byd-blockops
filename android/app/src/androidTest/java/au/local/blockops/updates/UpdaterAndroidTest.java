package au.local.blockops.updates;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.ComponentName;
import android.app.Activity;
import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.PackageInstaller;
import android.os.SystemClock;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.cert.Certificate;
import javax.net.ssl.HttpsURLConnection;
import java.util.HashMap;
import java.util.Map;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import static au.local.blockops.updates.UpdateModel.*;

/** Android runtime checks; the HTTPS socket alone is scripted for JSON fixtures. */
public final class UpdaterAndroidTest {
    private static final String SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    private static final String APK_SHA = "e208ef6fd6fdefb0cc6ea1e49eb31d4e0deff2956f3299252e86c51ae7a6385b";
    private static final String SIGNER = "6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49";
    private static final String BASE = "https://github.com/uptecio/byd-blockops/releases/download/v0.10.0/";
    private final UpdaterInstrumentation runner;
    private final Context context;
    UpdaterAndroidTest(UpdaterInstrumentation runner) { this.runner = runner; context = runner.getTargetContext(); }
    public void bridge() throws Exception {
        Class<?> bridge;
        try { bridge=Class.forName("au.local.blockops.updates.UpdateBridge"); }
        catch(ClassNotFoundException missing) { throw new AssertionError("Missing narrow updater bridge",missing); }
        java.util.Set<String> commands=new java.util.TreeSet<>();
        int annotated=0;
        for(java.lang.reflect.Method method:bridge.getMethods())if(method.isAnnotationPresent(android.webkit.JavascriptInterface.class)){
            annotated++;commands.add(method.getName());
            check(method.getReturnType()==void.class,"Bridge returns unexpected authority");
            check(java.util.Arrays.equals(method.getParameterTypes(),"homeState".equals(method.getName())?new Class<?>[]{String.class}:new Class<?>[]{}),"Unexpected bridge arguments");
        }
        check(annotated==3,"Extra annotated overload");
        check(commands.equals(new java.util.TreeSet<>(java.util.Arrays.asList("homeState","check","open"))),"Bridge exposes extra authority");
        runner.passed("threeCommandBridge");
        bridgeHomeAndEncoding();runner.passed("bridgeHomeAndEncoding");
        bridgeLateCallback();runner.passed("bridgeLateCallback");
        bridgeGates();runner.passed("bridgeGates");
    }
    private Object field(Object target,String name)throws Exception{
        java.lang.reflect.Field field=target.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(target);
    }
    private String evaluate(android.webkit.WebView view,String script)throws Exception{
        java.util.concurrent.CountDownLatch done=new java.util.concurrent.CountDownLatch(1);String[] value={null};
        runner.runOnMainSync(()->view.evaluateJavascript(script,result->{value[0]=result;done.countDown();}));
        check(done.await(10,java.util.concurrent.TimeUnit.SECONDS),"WebView evaluation timeout");return value[0];
    }
    private android.webkit.WebView homeView(Activity activity)throws Exception{
        android.webkit.WebView view=(android.webkit.WebView)field(activity,"gameView");
        long deadline=SystemClock.elapsedRealtime()+30000;
        while(SystemClock.elapsedRealtime()<deadline){
            if("true".equals(evaluate(view,"document.body && document.body.dataset.mode === 'home' && typeof window.receiveBlockOpsUpdate === 'function' && !document.getElementById('home-updates').hidden")))return view;
            SystemClock.sleep(100);
        }
        throw new AssertionError("Actual packaged game did not reach Home: "+evaluate(view,"document.body.innerText"));
    }
    private void bridgeHomeAndEncoding()throws Exception{
        Activity activity=runner.startActivitySync(new Intent(context,au.local.blockops.MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try{
            android.webkit.WebView view=homeView(activity);
            check(evaluate(view,"location.href").equals("\"https://appassets.androidplatform.net/assets/index.html\""),"Packaged origin changed");
            if(android.os.Build.VERSION.SDK_INT==26)check(evaluate(view,"typeof Object.fromEntries").equals("\"undefined\""),"Native startup masked missing runtime API");
            String message="Quote \" slash \\ line \u2028 paragraph \u2029 <img src=x onerror=alert(1)>";
            Snapshot snapshot=new Snapshot(987654,"available","0.10.0","0.11.0",200,0,message,false);
            Class<?> bridge=Class.forName("au.local.blockops.updates.UpdateBridge");
            java.lang.reflect.Method encode=bridge.getMethod("script",Snapshot.class);
            String script=(String)encode.invoke(null,snapshot);
            check(script.indexOf('\u2028')<0&&script.indexOf('\u2029')<0,"Old JavaScript line separator leaked");
            evaluate(view,script);
            String actual=evaluate(view,"document.getElementById('update-status').textContent");
            check(new JSONArray("["+actual+"]").getString(0).contains(message),"Native JSON text changed");
            check(evaluate(view,"document.getElementById('update-status').children.length").equals("0"),"Release became markup");
            evaluate(view,"BlockOpsUpdates.homeState('home')");runner.runOnMainSync(()->{});
            check(field(activity,"updateObservation")!=null,"No native observer");
        }finally{runner.runOnMainSync(activity::finish);}
    }
    private void bridgeGates()throws Exception{
        Activity activity=runner.startActivitySync(new Intent(context,au.local.blockops.MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try{
            android.webkit.WebView view=homeView(activity);Object bridge=field(activity,"updateBridge");
            java.lang.reflect.Method open=bridge.getClass().getMethod("open");
            evaluate(view,"document.getElementById('settings-screen').hidden=false;BlockOpsUpdates.open()");
            SystemClock.sleep(200);runner.runOnMainSync(()->{});check(field(activity,"updateDialog")==null,"Hidden Home opened native dialog");
            evaluate(view,"document.getElementById('settings-screen').hidden=true;BlockOpsUpdates.homeState('garbage');BlockOpsUpdates.homeState('home')");
            SystemClock.sleep(200);open.invoke(bridge);
            long deadline=SystemClock.elapsedRealtime()+10000;boolean[] shown={false};
            do { runner.runOnMainSync(()->{try{shown[0]=field(activity,"updateDialog")!=null;}catch(Exception e){throw new AssertionError(e);}});
                if(!shown[0])SystemClock.sleep(25);
            }while(!shown[0]&&SystemClock.elapsedRealtime()<deadline);
            check(shown[0],"Local foreground Home cannot open native dialog");
            runner.runOnMainSync(()->runner.callActivityOnPause(activity));
            check(field(activity,"updateDialog")==null&&field(activity,"updateObservation")==null,"Pause retained native presentation");
            open.invoke(bridge);SystemClock.sleep(200);runner.runOnMainSync(()->{});check(field(activity,"updateDialog")==null,"Background Activity opened dialog");
            runner.runOnMainSync(()->runner.callActivityOnResume(activity));SystemClock.sleep(200);
            runner.runOnMainSync(()->view.loadData("<html><body>foreign</body></html>","text/html","UTF-8"));SystemClock.sleep(200);
            open.invoke(bridge);SystemClock.sleep(200);runner.runOnMainSync(()->{});check(field(activity,"updateDialog")==null,"Nonlocal document opened dialog");
            runner.runOnMainSync(()->{try{java.lang.reflect.Method failure=activity.getClass().getDeclaredMethod("showFailure",String.class);failure.setAccessible(true);failure.invoke(activity,"Fixture renderer unavailable");}catch(Exception e){throw new AssertionError(e);}});
            open.invoke(bridge);runner.runOnMainSync(()->{});check(field(activity,"updateDialog")==null,"Destroyed view opened dialog");
        }finally{runner.runOnMainSync(activity::finish);}
    }
    private void bridgeLateCallback()throws Exception{
        Activity activity=runner.startActivitySync(new Intent(context,au.local.blockops.MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        homeView(activity);Throwable[] problem={null};
        runner.runOnMainSync(()->{android.webkit.WebView original=null;PendingProbeView pending=null;try{
            original=(android.webkit.WebView)field(activity,"gameView");pending=new PendingProbeView(activity);
            java.lang.reflect.Field view=activity.getClass().getDeclaredField("gameView");view.setAccessible(true);view.set(activity,pending);
            java.lang.reflect.Method request=activity.getClass().getDeclaredMethod("updateRequest",android.webkit.WebView.class,String.class);request.setAccessible(true);
            request.invoke(activity,pending,"open");android.webkit.ValueCallback<String> callback=pending.probe;
            check(callback!=null,"No asynchronous eligibility probe");
            runner.callActivityOnPause(activity);runner.callActivityOnResume(activity);
            callback.onReceiveValue("true");check(field(activity,"updateDialog")==null,"Old paused-view callback opened after resume");
            request.invoke(activity,pending,"open");callback=pending.probe;
            request.invoke(activity,pending,"hidden");callback.onReceiveValue("true");
            check(field(activity,"updateDialog")==null,"Old Home callback reopened after Home exit");
        }catch(Throwable failure){problem[0]=failure;}finally{try{
            java.lang.reflect.Field view=activity.getClass().getDeclaredField("gameView");view.setAccessible(true);view.set(activity,original);
            if(pending!=null)pending.destroy();activity.finish();
        }catch(Exception failure){problem[0]=failure;}}});
        if(problem[0]!=null)throw new AssertionError(problem[0]);
    }
    private static final class PendingProbeView extends android.webkit.WebView {
        android.webkit.ValueCallback<String> probe;
        PendingProbeView(Context context){super(context);}
        @Override public String getUrl(){return "https://appassets.androidplatform.net/assets/index.html";}
        @Override public void evaluateJavascript(String script,android.webkit.ValueCallback<String> callback){if(script.startsWith("(function()"))probe=callback;}
    }
    public void run() throws Exception {
        parseGithubJson(); runner.passed("parseGithubJson");
        parseActualApk(); runner.passed("parseActualApk");
        permissionRequiresSecondTap(); runner.passed("permissionRequiresSecondTap");
        wrongSessionIgnored(); runner.passed("wrongSessionIgnored");
        pendingActionForegroundOnly(); runner.passed("pendingActionForegroundOnly");
        restartDoesNotRecommit(); runner.passed("restartDoesNotRecommit");
        cancelOnlyOwnedSession(); runner.passed("cancelOnlyOwnedSession");
        sessionRemovalTiming();runner.passed("sessionRemovalTiming");
        delayedSessionRemoval();runner.passed("delayedSessionRemoval");
        removalCallbacksRemainResponsive();runner.passed("removalCallbacksRemainResponsive");
        realOwnedSessions(); runner.passed("realOwnedSessions");
    }
    private void sessionRemovalTiming() throws Exception {
        AndroidUpdateInstaller.NativePlatform platform=new AndroidUpdateInstaller.NativePlatform(context);
        for(int attempt=0;attempt<5;attempt++){
            int id=platform.create(3);long start=SystemClock.elapsedRealtime();
            try{
                platform.abandon(id);boolean initiallyPresent=platform.session(id)!=null;
                while(platform.session(id)!=null&&SystemClock.elapsedRealtime()-start<2000)SystemClock.sleep(25);
                check(platform.session(id)==null,"Owned diagnostic session still present");
                runner.passed("sessionRemovalTiming id="+id+" initiallyPresent="+initiallyPresent+" elapsedMs="+(SystemClock.elapsedRealtime()-start));
            }finally{if(platform.session(id)!=null)platform.abandon(id);}
        }
    }
    private void delayedSessionRemoval() throws Exception {
        Rig cancel=new Rig();int id=cancel.installer.commit(fixture());int unrelated=cancel.platform.create(3);
        cancel.platform.removalQueries=3;cancel.installer.cancelOwned(id);
        check(cancel.store.id==null&&!cancel.platform.sessions.containsKey(id)&&cancel.platform.sessions.containsKey(unrelated),"Delayed cancellation lost ownership/isolation");
        Rig recover=new Rig();int writing=recover.platform.create(3);recover.store.set(writing);recover.platform.removalQueries=3;
        check(recover.installer.reconcile(null).phase.equals("idle")&&recover.store.id==null,"Delayed recovery failed");
        Rig failed=new Rig();int pending=failed.installer.commit(fixture());failed.platform.ignoreAbandon=true;
        long started=SystemClock.elapsedRealtime();rejected(()->failed.installer.cancelOwned(pending));
        check(failed.store.id==pending&&SystemClock.elapsedRealtime()-started<2500,"Unbounded failure or ownership cleared before removal");
        rejected(()->failed.installer.commit(fixture()));check(failed.platform.commitCalls==1,"Failure permitted second submit");
    }
    private void removalCallbacksRemainResponsive() throws Exception {
        Rig terminal=new Rig();int id=terminal.installer.commit(fixture());terminal.platform.ignoreAbandon=true;
        Throwable[] outcome={null};Thread waiting=new Thread(()->{try{terminal.installer.cancelOwned(id);}catch(Throwable failure){outcome[0]=failure;}});
        waiting.start();check(terminal.platform.abandonStarted.await(1,java.util.concurrent.TimeUnit.SECONDS),"Removal did not start");
        long before=SystemClock.elapsedRealtime();runner.runOnMainSync(()->{synchronized(terminal.installer){
            terminal.platform.sessions.remove(id);
            try{terminal.installer.handleStatus(status(id,PackageInstaller.STATUS_SUCCESS));}catch(Exception failure){throw new AssertionError(failure);}
        }});
        check(SystemClock.elapsedRealtime()-before<500,"Removal blocked UI callback");waiting.join(2500);
        check(!waiting.isAlive()&&outcome[0]==null&&terminal.store.id==null&&terminal.events.size()==1,"Terminal callback became cleanup error");

        Rig replaced=new Rig();int old=replaced.installer.commit(fixture());int replacement=replaced.platform.create(3);replaced.platform.ignoreAbandon=true;
        Throwable[] changed={null};Thread replacing=new Thread(()->{try{replaced.installer.cancelOwned(old);}catch(Throwable failure){changed[0]=failure;}});
        replacing.start();check(replaced.platform.abandonStarted.await(1,java.util.concurrent.TimeUnit.SECONDS),"Replacement wait did not start");
        synchronized(replaced.installer){replaced.store.id=replacement;}replacing.join(2500);
        check(!replacing.isAlive()&&changed[0]!=null&&replaced.store.id==replacement&&replaced.platform.sessions.containsKey(replacement),"Changed ownership cleared/abandoned replacement");

        Rig interrupted=new Rig();int owned=interrupted.installer.commit(fixture());interrupted.platform.ignoreAbandon=true;
        boolean[] retainedInterrupt={false};Thread interrupting=new Thread(()->{try{interrupted.installer.cancelOwned(owned);}catch(Exception expected){retainedInterrupt[0]=Thread.currentThread().isInterrupted();}});
        interrupting.start();check(interrupted.platform.abandonStarted.await(1,java.util.concurrent.TimeUnit.SECONDS),"Interrupt wait did not start");
        interrupting.interrupt();interrupting.join(1000);check(!interrupting.isAlive()&&retainedInterrupt[0]&&interrupted.store.id==owned,"Interrupted removal lost ownership/interruption");
    }
    public void controller() throws Exception {
        try{Class.forName("au.local.blockops.updates.UpdateDialog");}
        catch(ClassNotFoundException missing){throw new AssertionError("Missing native updater dialog",missing);}
        discoverOwnedSession();runner.passed("discoverOwnedSession");
        durablePreferences();runner.passed("durablePreferences");
        nativeDialog();runner.passed("nativeDialog");
        applicationLifecycle();runner.passed("applicationLifecycle");
        startupReceiverOrdering();runner.passed("startupReceiverOrdering");
        cancelDuringStaging();runner.passed("cancelDuringStaging");
        cancelAfterSubmissionGate();runner.passed("cancelAfterSubmissionGate");
        installedIdentity();runner.passed("installedIdentity");
        invalidFactoryIsInert();runner.passed("invalidFactoryIsInert");
    }
    private void installedIdentity()throws Exception{
        android.content.pm.PackageInfo actual=context.getPackageManager().getPackageInfo(context.getPackageName(),android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES);
        InstalledApp installed=AndroidApkVerifier.readInstalled(context);
        String actualHash=HttpsUpdateTransport.hex(HttpsUpdateTransport.sha256().digest(actual.signingInfo.getApkContentsSigners()[0].toByteArray()));
        check(installed.signerSha256.equals(actualHash)&&installed.signerSha256.equals(SIGNER)
            &&installed.versionCode==actual.getLongVersionCode()&&installed.versionName.equals(actual.versionName),"Installed identity was not read from PackageManager");
        android.content.pm.PackageInfo legacy=new android.content.pm.PackageInfo();legacy.packageName=actual.packageName;
        legacy.versionName=actual.versionName;legacy.versionCode=actual.versionCode;legacy.signatures=actual.signingInfo.getApkContentsSigners();
        check(AndroidApkVerifier.decodeInstalled(legacy,26).signerSha256.equals(actualHash),"Legacy current signer not read");
        check(AndroidApkVerifier.decodeInstalled(legacy,27).signerSha256.equals(actualHash),"API27 current signer not read");
        rejected(()->AndroidApkVerifier.decodeInstalled(null,36));
        rejected(()->AndroidApkVerifier.decodeInstalled(legacy,28)); // No current SigningInfo; no legacy fallback.
        legacy.signatures=null;rejected(()->AndroidApkVerifier.decodeInstalled(legacy,26));
        legacy.signatures=new android.content.pm.Signature[0];rejected(()->AndroidApkVerifier.decodeInstalled(legacy,26));
        legacy.signatures=new android.content.pm.Signature[]{null};rejected(()->AndroidApkVerifier.decodeInstalled(legacy,26));
        legacy.signatures=new android.content.pm.Signature[]{new android.content.pm.Signature(new byte[]{1})};rejected(()->AndroidApkVerifier.decodeInstalled(legacy,26));
        android.content.pm.Signature trusted=actual.signingInfo.getApkContentsSigners()[0];
        legacy.signatures=new android.content.pm.Signature[]{trusted,trusted};rejected(()->AndroidApkVerifier.decodeInstalled(legacy,26));
        legacy.signatures=new android.content.pm.Signature[]{trusted};legacy.versionName="invalid";rejected(()->AndroidApkVerifier.decodeInstalled(legacy,26));
        legacy.versionName=actual.versionName;legacy.packageName="foreign.package";rejected(()->AndroidApkVerifier.decodeInstalled(legacy,26));
        legacy.packageName=actual.packageName;legacy.versionCode=0;rejected(()->AndroidApkVerifier.decodeInstalled(legacy,26));
    }
    private void invalidFactoryIsInert() throws Exception {
        java.util.concurrent.atomic.AtomicInteger network=new java.util.concurrent.atomic.AtomicInteger();
        // Last case in this isolated instrumentation process: every Java HTTPS connection is forbidden.
        URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){
            protected URLConnection openConnection(URL url)throws IOException{network.incrementAndGet();throw new IOException("Unexpected network");}
        }:null);
        InvalidIdentityApplication app=new InvalidIdentityApplication();Throwable[] problem={null};
        runner.runOnMainSync(()->{try{app.attach(context);app.onCreate();app.updater().home(true);app.updater().foreground(true);}
            catch(Throwable failure){problem[0]=failure;}});
        if(problem[0]!=null)throw new AssertionError("Invalid identity crashed game startup",problem[0]);
        drainApplication(app);
        check(app.updater().snapshot().phase.equals("error"),"Untrusted factory did not publish an error");
        Activity activity=runner.startActivitySync(new Intent(context,au.local.blockops.MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        runner.runOnMainSync(()->{try{
            UpdateDialog presentation=new UpdateDialog(activity,app.updater());presentation.show();
            java.lang.reflect.Field field=UpdateDialog.class.getDeclaredField("dialog");field.setAccessible(true);
            ((android.app.AlertDialog)field.get(presentation)).getButton(-1).performClick();
            presentation.detach();
        }catch(Throwable failure){problem[0]=failure;}});
        if(problem[0]!=null)throw new AssertionError(problem[0]);drainApplication(app);
        check(app.updater().snapshot().phase.equals("error"),"Retry escaped fail-closed identity state");
        runner.runOnMainSync(()->{app.updater().download();app.updater().install();app.updater().openPermissionSettings();app.updater().cancel();});
        drainApplication(app);
        check(network.get()==0&&app.launches==0&&app.updateInstaller()==null,"Invalid identity reached network/platform installer");
        check(app.updater().snapshot().message.length()<=240,"Unbounded identity failure");
        runner.runOnMainSync(()->{activity.finish();app.onTerminate();});
    }
    private void drainApplication(au.local.blockops.BlockOpsApplication app)throws Exception{
        java.lang.reflect.Field field=au.local.blockops.BlockOpsApplication.class.getDeclaredField("worker");field.setAccessible(true);
        java.util.concurrent.ExecutorService worker=(java.util.concurrent.ExecutorService)field.get(app);
        for(int i=0;i<3;i++){worker.submit(()->{}).get(2,java.util.concurrent.TimeUnit.SECONDS);runner.waitForIdleSync();}
    }
    static final class InvalidIdentityApplication extends au.local.blockops.BlockOpsApplication {
        int launches;void attach(Context base){attachBaseContext(base);}
        @Override public String getPackageName(){return "au.local.blockops.missing.identity";}
        @Override public File getFilesDir(){throw new AssertionError("Untrusted identity opened candidate files");}
        @Override public android.content.SharedPreferences getSharedPreferences(String name,int mode){throw new AssertionError("Untrusted identity opened updater preferences");}
        @Override public void startActivity(Intent intent){launches++;throw new AssertionError("Untrusted identity launched an Activity");}
    }
    private void durablePreferences() throws Exception {
        Context isolated=new ContextWrapper(context){@Override public android.content.SharedPreferences getSharedPreferences(String name,int mode){
            return super.getSharedPreferences("test-task4-"+name,mode);}};
        android.content.SharedPreferences raw=isolated.getSharedPreferences("block-ops-updater-v1",0);raw.edit().clear().commit();
        try{
            UpdatePreferences prefs=new UpdatePreferences(isolated);Release release=fixture().release;
            prefs.set(17);prefs.save(new SavedState(100,200,300,release));
            UpdatePreferences reopened=new UpdatePreferences(isolated);
            check(reopened.get()==17&&reopened.load().cachedRelease.asset.id==release.asset.id,"State write lost session/release");
            reopened.set(null);check(reopened.load().lastSuccessWallMillis==100&&reopened.get()==null,"Session write lost state");
            raw.edit().putString("release","corrupt").commit();
            check(reopened.load().cachedRelease==null,"Corrupt cache trusted");
        }finally{raw.edit().clear().commit();}
    }
    private void nativeDialog() throws Exception {
        Activity activity=runner.startActivitySync(new Intent(context,au.local.blockops.MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        ControllerRig rig=new ControllerRig();
        final Throwable[] problem={null};
        runner.runOnMainSync(()->{try{
            rig.drain();rig.controller.home(true);rig.controller.foreground(true);rig.controller.check(true);rig.drain();
            UpdateDialog presentation=new UpdateDialog(activity,rig.controller);presentation.show();
            java.lang.reflect.Field field=UpdateDialog.class.getDeclaredField("dialog");field.setAccessible(true);
            android.app.AlertDialog dialog=(android.app.AlertDialog)field.get(presentation);
            String text=((android.widget.TextView)dialog.findViewById(android.R.id.message)).getText().toString();
            check(text.contains("0.10.0")&&text.contains("0.11.0")&&text.contains("100"),"Missing version/size text");
            dialog.getButton(android.content.DialogInterface.BUTTON_NEGATIVE).performClick();rig.drain();check(rig.controller.snapshot().dismissed,"Later did not dismiss session offer");
            presentation.show();presentation.render(new Snapshot(50,"downloading","0.10.0","0.11.0",100,25,"Downloading",false));
            text=((android.widget.TextView)dialog.findViewById(android.R.id.message)).getText().toString();
            check(text.contains("25")&&text.contains("100")&&!dialog.getButton(-1).isEnabled(),"Progress or duplicate action wrong");
            rig.now+=30000;rig.controller.download();rig.drain();rig.allowed=false;rig.controller.install();rig.drain();presentation.render(rig.controller.snapshot());
            text=((android.widget.TextView)dialog.findViewById(android.R.id.message)).getText().toString();
            check(text.contains("Settings")&&text.contains("Install"),"Permission explanation missing");
            dialog.getButton(-1).performClick();rig.drain();check(rig.settings==1&&rig.commits==0,"Settings action submitted install");
            rig.allowed=true;rig.controller.foreground(false);rig.controller.foreground(true);rig.drain();presentation.render(rig.controller.snapshot());
            check(rig.commits==0,"Permission return auto installed");dialog.getButton(-1).performClick();rig.drain();check(rig.commits==1,"Second Install tap did not submit");
            presentation.render(rig.controller.snapshot());check(!dialog.getButton(-1).isEnabled(),"Duplicate Install enabled while waiting");
            rig.controller.activityDetached();rig.events.accept(new InstallEvent(7,"confirmation","Confirm installation"));rig.drain();
            check(rig.confirms==0,"Lost Activity consent launched confirmation");rig.controller.foreground(true);presentation.render(rig.controller.snapshot());
            check(dialog.getButton(-1).isEnabled(),"Fresh native confirmation action missing");dialog.getButton(-1).performClick();rig.drain();
            check(rig.confirms==1&&rig.commits==1,"Fresh tap resubmitted or failed to confirm");
            rig.cancelFailure=true;dialog.getButton(-3).performClick();rig.drain();presentation.render(rig.controller.snapshot());
            check(dialog.getButton(-3).getVisibility()==android.view.View.VISIBLE&&dialog.getButton(-3).isEnabled(),"Timeout hid cancellation recovery");
            rig.cancelFailure=false;dialog.getButton(-3).performClick();rig.drain();presentation.render(rig.controller.snapshot());
            check(rig.cancels==2&&rig.controller.snapshot().phase.equals("ready"),"Native cancellation retry failed");
            dialog.getButton(-1).performClick();rig.drain();rig.confirmFailure=true;rig.events.accept(new InstallEvent(7,"confirmation","Confirm"));rig.drain();presentation.render(rig.controller.snapshot());
            check(dialog.getButton(-3).getVisibility()==android.view.View.VISIBLE,"Failed confirmation stranded native controls");
            dialog.getButton(-3).performClick();rig.drain();check(rig.controller.snapshot().phase.equals("ready"),"Failed-confirmation session could not be cancelled");
            presentation.detach();check(!dialog.isShowing(),"Detach kept old window");rig.controller.close();rig.drain();
        }catch(Throwable failure){problem[0]=failure;}finally{activity.finish();}});
        if(problem[0]!=null)throw new AssertionError(problem[0]);
    }
    private void applicationLifecycle() throws Exception {
        final Throwable[] problem={null};runner.runOnMainSync(()->{try{
            ControllerRig rig=new ControllerRig();TestApplication app=new TestApplication(rig);app.attach(context);app.onCreate();
            Activity first=new Activity(){@Override public boolean isChangingConfigurations(){return true;}};
            Activity second=new Activity();int[] observed={0};AutoCloseable subscription=app.observeUpdates(s->observed[0]++);
            rig.drain();app.onActivityStarted(first);app.onActivityResumed(first);app.setHome(first,true);rig.drain();
            check(app.eligibleActivity()==first,"Home activity not eligible");rig.controller.check(true);rig.drain();rig.now+=30000;rig.controller.download();
            app.onActivityPaused(first);check(app.eligibleActivity()==null,"Paused activity retained for launch");
            app.onActivityStopped(first);app.onActivityDestroyed(first);
            app.onActivityStarted(second);app.onActivityResumed(second);app.setHome(second,true);rig.drain();
            check(rig.downloads==1&&rig.controller.snapshot().phase.equals("ready"),"Recreation cancelled transfer");
            check(app.eligibleActivity()==second,"Replacement activity not eligible");
            rig.controller.install();rig.drain();app.onActivityPaused(first);app.onActivityDestroyed(first);
            rig.events.accept(new InstallEvent(7,"confirmation","Confirm"));rig.drain();
            check(rig.confirms==1,"Late old Activity callback revoked replacement consent");
            check(observed[0]>0,"Observer received no state");int count=observed[0];subscription.close();rig.controller.dismiss();rig.drain();check(observed[0]==count,"Detached observer called");
            app.onActivityPaused(second);app.onActivityStopped(second);check(app.eligibleActivity()==null,"Background activity eligible");
            rig.controller.close();rig.drain();app.onTerminate();
        }catch(Throwable failure){problem[0]=failure;}});if(problem[0]!=null)throw new AssertionError(problem[0]);
    }
    static final class TestApplication extends au.local.blockops.BlockOpsApplication {
        final ControllerRig rig;TestApplication(ControllerRig rig){this.rig=rig;}
        void attach(Context context){attachBaseContext(context);}
        @Override protected UpdateController createUpdater(){rig.listener=this::dispatchUpdate;return rig.controller;}
    }
    static final class ControllerRig implements UpdatePorts.Installer,UpdatePorts.CandidateStore {
        long now=1800000000000L;int downloads,commits,settings,confirms,cancels;boolean allowed=true,cancelFailure,confirmFailure;Integer recorded;
        java.util.function.Consumer<InstallEvent> events;UpdatePorts.Listener listener=s->{};
        final java.util.ArrayDeque<Runnable> ui=new java.util.ArrayDeque<>(),worker=new java.util.ArrayDeque<>();
        final Release release=new Release(1,"v0.11.0",new Version(0,11,0),new Asset(1,"block-ops-test.apk",
            URI.create("https://github.com/uptecio/byd-blockops/releases/download/v0.11.0/block-ops-test.apk"),100,"sha256:"+zeros(64)),zeros(64),"");
        Candidate candidate;
        final UpdateController controller=new UpdateController(new InstalledApp("au.local.blockops","0.10.0",14,SIGNER,36),t->release,this,
            (c,i)->new ApkIdentity(i.packageName,"0.11.0",15,i.signerSha256,26),this,new UpdatePorts.StateStore(){
                public SavedState load(){return new SavedState(0,0,0,null);}public void save(SavedState s){}},
            new UpdatePorts.Clock(){public long wallMillis(){return now;}public long elapsedMillis(){return now;}},worker::add,ui::add,s->listener.onState(s),worker::add);
        void drain(){for(int i=0;i<20&&(!ui.isEmpty()||!worker.isEmpty());i++){while(!ui.isEmpty())ui.remove().run();while(!worker.isEmpty())worker.remove().run();}}
        public Candidate load(){return candidate;}public Candidate download(Release r,UpdateCancellation t,UpdatePorts.Progress p)throws UpdatePorts.Failure{t.check();downloads++;return candidate=new Candidate(new File("test"),r);}
        public void forget(){candidate=null;}public void deletePartial(){}
        public boolean allowed(){return allowed;}public void openPermissionSettings(){settings++;}public int commit(Candidate c,UpdateCancellation cancellation)throws UpdatePorts.Failure{cancellation.check();commits++;recorded=7;return 7;}
        public void confirm(int id)throws UpdatePorts.Failure{if(confirmFailure)throw new UpdatePorts.Failure("install_failed","Confirmation failed");confirms++;}
        public InstallEvent reconcile(Integer id){return recorded==null?new InstallEvent(-1,"idle",""):new InstallEvent(recorded,"installing","Pending");}
        public void cancelOwned(int id)throws UpdatePorts.Failure{cancels++;if(cancelFailure)throw new UpdatePorts.Failure("install_failed","Cancellation timed out");recorded=null;}
        public void setListener(java.util.function.Consumer<InstallEvent> l){events=l;}
    }
    private void startupReceiverOrdering() throws Exception {
        Rig rig=new Rig();Candidate candidate=fixture();int id=rig.installer.commit(candidate);
        ManualQueue ui=new ManualQueue(),worker=new ManualQueue();int[] checks={0};
        UpdateController controller=adapterController(rig,candidate,worker,ui,(c,i)->{
            rig.installer.handleStatus(status(id,PackageInstaller.STATUS_SUCCESS));ui.run();
            return new AndroidApkVerifier(context).inspect(c,i);
        },checks);
        drain(worker,ui);check(rig.store.id==null&&!controller.snapshot().phase.equals("installing"),"Startup revived stale reconciled session");
        controller.home(true);controller.foreground(true);controller.check(true);drain(worker,ui);
        check(checks[0]==1,"Startup terminal result left checks blocked");controller.close();drain(worker,ui);
    }
    private void cancelDuringStaging() throws Exception {
        Rig rig=new Rig();Candidate candidate=fixture();ManualQueue ui=new ManualQueue(),worker=new ManualQueue();
        UpdateController controller=adapterController(rig,candidate,worker,ui,new AndroidApkVerifier(context),new int[]{0});drain(worker,ui);
        controller.home(true);controller.foreground(true);
        rig.platform.afterWrite=()->runner.runOnMainSync(controller::cancel);
        controller.install();drain(worker,ui);
        check(rig.platform.commitCalls==0,"Cancelled staging still submitted");
        check(rig.store.id==null&&rig.platform.sessions.isEmpty(),"Cancelled staging retained owned unsubmitted session");
        check(controller.snapshot().phase.equals("ready")&&rig.platform.launches==0,"Cancelled staging revived install/confirmation UI");
        controller.close();drain(worker,ui);
    }
    private void cancelAfterSubmissionGate() throws Exception {
        Rig rig=new Rig();Candidate candidate=fixture();ManualQueue ui=new ManualQueue(),worker=new ManualQueue();
        UpdateController controller=adapterController(rig,candidate,worker,ui,new AndroidApkVerifier(context),new int[]{0});drain(worker,ui);
        controller.home(true);controller.foreground(true);rig.platform.throwAfterSubmit=true;
        rig.platform.afterSubmit=()->{
            runner.runOnMainSync(controller::cancel);
            try{rig.installer.handleStatus(status(rig.store.id,PackageInstaller.STATUS_PENDING_USER_ACTION).putExtra(Intent.EXTRA_INTENT,new Intent("fixture.confirm")));}
            catch(Exception failure){throw new AssertionError(failure);}
        };
        controller.install();drain(worker,ui);
        check(rig.platform.commitCalls==1&&rig.store.id==null&&rig.platform.sessions.isEmpty(),"Uncertain cancelled submit was not resolved");
        check(controller.snapshot().phase.equals("ready")&&rig.platform.launches==0,"Uncertain cancelled submit revived confirmation/UI");
        controller.close();drain(worker,ui);
    }
    private UpdateController adapterController(Rig rig,Candidate candidate,ManualQueue worker,ManualQueue ui,UpdatePorts.Verifier verifier,int[] checks){
        return new UpdateController(new InstalledApp("au.local.blockops","0.9.0",13,SIGNER,36),t->{checks[0]++;return candidate.release;},
            new UpdatePorts.CandidateStore(){public Candidate load(){return candidate;}public Candidate download(Release r,UpdateCancellation t,UpdatePorts.Progress p){return candidate;}
                public void deletePartial(){}public void forget(){}},verifier,rig.installer,
            new UpdatePorts.StateStore(){public SavedState load(){return new SavedState(0,0,0,null);}public void save(SavedState s){}},
            new UpdatePorts.Clock(){public long wallMillis(){return 1800000000000L;}public long elapsedMillis(){return SystemClock.elapsedRealtime();}},worker,ui,s->{},worker);
    }
    private static final class ManualQueue implements java.util.concurrent.Executor{
        final java.util.concurrent.ConcurrentLinkedQueue<Runnable> tasks=new java.util.concurrent.ConcurrentLinkedQueue<>();
        public void execute(Runnable task){tasks.add(task);}void run(){Runnable task;while((task=tasks.poll())!=null)task.run();}
    }
    private static void drain(ManualQueue worker,ManualQueue ui){for(int i=0;i<20&&(!worker.tasks.isEmpty()||!ui.tasks.isEmpty());i++){worker.run();ui.run();}}
    private void discoverOwnedSession() throws Exception {
        Rig empty=new Rig();check(empty.installer.reconcile(null).phase.equals("idle"),"No-record discovery failed");
        Rig sealed=new Rig();int id=sealed.installer.commit(fixture());
        check(sealed.installer.reconcile(null).phase.equals("installing"),"Null did not discover owned sealed session");
        check(sealed.installer.reconcile(id+1).phase.equals("idle")&&sealed.store.id==id,"Wrong ID changed owned session");
        Rig unsealed=new Rig();int writing=unsealed.platform.create(3);unsealed.store.set(writing);
        check(unsealed.installer.reconcile(null).phase.equals("idle")&&unsealed.store.id==null
            &&!unsealed.platform.sessions.containsKey(writing),"Null did not reconcile owned unsealed session");
    }
    // Returning from permission Settings may never submit a session without another install call.
    private void permissionRequiresSecondTap() throws Exception {
        Rig rig = new Rig(); rig.platform.allowed = false;
        rejected(() -> rig.installer.commit(fixture()));
        rig.installer.openPermissionSettings();
        check(rig.platform.launches == 1 && rig.platform.lastIntent.getAction().equals(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                && rig.platform.lastIntent.getDataString().equals("package:au.local.blockops"), "Wrong permission Settings");
        rig.platform.allowed = true;
        rig.installer.reconcile(null);
        check(rig.platform.commitCalls == 0 && rig.store.id == null, "Permission return auto-committed");
        rig.installer.commit(fixture());
        check(rig.platform.commitCalls == 1 && rig.inspections == 2, "Explicit install not revalidated and submitted once");
        check(rig.platform.recordedBeforeSubmit, "Session was not durably recorded before submission");
        Rig invalid = new Rig(); invalid.rejectInspection = true;
        rejected(() -> invalid.installer.commit(fixture()));
        check(invalid.platform.commitCalls == 0, "Invalid candidate submitted");
        Rig revalidation = new Rig(); revalidation.rejectSecondInspection = true;
        rejected(() -> revalidation.installer.commit(fixture()));
        check(revalidation.platform.commitCalls == 0 && revalidation.store.id == null
                && revalidation.platform.sessions.isEmpty(), "Second validation failure left a submitted/staged session");
        Rig background = new Rig(); background.platform.afterWrite = () -> background.foreground = null;
        rejected(() -> background.installer.commit(fixture()));
        check(background.platform.commitCalls == 0 && background.store.id == null, "Backgrounded staging committed");
        Rig updated = new Rig();updated.platform.afterWrite=()->updated.platform.currentCode=14;
        rejected(()->updated.installer.commit(fixture()));check(updated.platform.commitCalls==0&&updated.store.id==null,"Changed installed version submitted a second update");
        Rig persistence = new Rig(); persistence.store.rejectSave = true;
        rejected(() -> persistence.installer.commit(fixture()));
        check(persistence.platform.commitCalls == 0 && persistence.platform.sessions.isEmpty(), "Failed durable write submitted/leaked a session");
    }
    // Foreign/missing callback fields cannot change owned work; unknown terminal codes fail safely.
    private void wrongSessionIgnored() throws Exception {
        Rig rig = new Rig(); int id = rig.installer.commit(fixture());
        ReceiverContext application = new ReceiverContext(context, rig.installer);
        UpdateInstallReceiver receiver = new UpdateInstallReceiver();
        receiver.onReceive(application, status(id + 1, PackageInstaller.STATUS_SUCCESS));
        receiver.onReceive(application, status(id, PackageInstaller.STATUS_SUCCESS).setAction("foreign"));
        rig.installer.handleStatus(status(id, PackageInstaller.STATUS_SUCCESS).setData(android.net.Uri.parse("blockops-update:999")));
        Intent noStatus = status(id, PackageInstaller.STATUS_SUCCESS); noStatus.removeExtra(PackageInstaller.EXTRA_STATUS);
        receiver.onReceive(application, noStatus);
        check(rig.store.id == id && rig.events.isEmpty(), "Unrelated status changed recorded session");
        check(!context.getPackageManager().getReceiverInfo(new ComponentName(context, UpdateInstallReceiver.class), 0).exported,
                "Status receiver is externally exported");
        for (int terminal : new int[]{PackageInstaller.STATUS_SUCCESS, PackageInstaller.STATUS_FAILURE,
                PackageInstaller.STATUS_FAILURE_BLOCKED, PackageInstaller.STATUS_FAILURE_ABORTED,
                PackageInstaller.STATUS_FAILURE_INVALID, PackageInstaller.STATUS_FAILURE_CONFLICT,
                PackageInstaller.STATUS_FAILURE_STORAGE, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE, 999}) {
            Rig other = new Rig(); int owned = other.installer.commit(fixture());
            receiver.onReceive(new ReceiverContext(context, other.installer), status(owned, terminal));
            check(other.store.id == null && other.events.size() == 1, "Terminal status left stale state");
            check(other.events.get(0).phase.equals(terminal == PackageInstaller.STATUS_SUCCESS ? "idle" : "error"), "Wrong terminal phase");
        }
    }
    // A pending callback is passive; only an explicit continuation with current Home consent launches.
    private void pendingActionForegroundOnly() throws Exception {
        Rig rig = new Rig(); int id = rig.installer.commit(fixture());
        rig.foreground = null;
        rig.installer.handleStatus(status(id, PackageInstaller.STATUS_PENDING_USER_ACTION)
                .putExtra(Intent.EXTRA_INTENT, new Intent("fixture.confirm")));
        check(rig.platform.launches == 0 && rig.events.size() == 1, "Background callback launched confirmation");
        rejected(() -> rig.installer.confirm(id));
        check(rig.platform.launches == 0, "Background confirm launched");
        rig.foreground = activity(); rig.installer.confirm(id);
        check(rig.platform.launches == 1, "Foreground continuation did not launch");
        rejected(() -> rig.installer.confirm(id));
        rig.installer.handleStatus(status(id, PackageInstaller.STATUS_PENDING_USER_ACTION)
                .putExtra(Intent.EXTRA_INTENT, new Intent("fixture.confirm")));
        AndroidUpdateInstaller restarted = rig.recreate();
        rejected(() -> restarted.confirm(id));
        check(rig.platform.launches == 1, "Restart restored confirmation intent");
    }
    // Recreating the adapter around a sealed submission cannot permit a second commit.
    private void restartDoesNotRecommit() throws Exception {
        Rig rig = new Rig(); int id = rig.installer.commit(fixture());
        AndroidUpdateInstaller restarted = rig.recreate();
        check(restarted.reconcile(id).phase.equals("installing"), "Uncertain submission not preserved");
        rejected(() -> restarted.commit(fixture()));
        check(rig.platform.commitCalls == 1, "Restart recommitted");
        rig.platform.sessions.remove(id);
        check(restarted.reconcile(id).phase.equals("idle") && rig.store.id == null, "Missing session record not cleared");
        Rig writing = new Rig(); int unsealed = writing.platform.create(3); writing.store.set(unsealed);
        check(writing.recreate().reconcile(unsealed).phase.equals("idle"), "Unsubmitted session not reconciled");
        check(!writing.platform.sessions.containsKey(unsealed) && writing.store.id == null, "Unsubmitted session not abandoned");
        Rig uncertain = new Rig(); uncertain.platform.throwAfterSubmit = true;
        rejected(() -> uncertain.installer.commit(fixture()));
        check(uncertain.store.id != null && uncertain.platform.commitCalls == 1, "Uncertain commit record lost");
        rejected(() -> uncertain.recreate().commit(fixture()));
        check(uncertain.platform.commitCalls == 1, "Uncertain commit retried");
    }
    // Cancel must leave all sessions except the explicitly recorded owned ID intact.
    private void cancelOnlyOwnedSession() throws Exception {
        Rig rig = new Rig(); int id = rig.installer.commit(fixture()); int unrelated = rig.platform.create(3);
        rejected(() -> rig.installer.cancelOwned(unrelated));
        check(rig.platform.sessions.containsKey(id) && rig.platform.sessions.containsKey(unrelated), "Foreign cancellation changed sessions");
        rig.installer.cancelOwned(id);
        check(rig.store.id == null && !rig.platform.sessions.containsKey(id) && rig.platform.sessions.containsKey(unrelated), "Cancel touched unrelated session");
        rig.installer.commit(fixture()); check(rig.platform.commitCalls == 2, "Cancel did not permit fresh explicit install");
        Rig failed = new Rig(); int failId = failed.installer.commit(fixture()); failed.platform.ignoreAbandon = true;
        rejected(() -> failed.installer.cancelOwned(failId));
        check(failed.store.id == failId, "Unverified cancellation cleared ownership");
    }
    // Actual platform session ownership, full mode, write/fsync, readback and abandonment on API36.
    private void realOwnedSessions() throws Exception {
        AndroidUpdateInstaller.NativePlatform platform = new AndroidUpdateInstaller.NativePlatform(context);
        MemorySessionStore store = new MemorySessionStore();
        Candidate candidate = fixture();
        int owned = platform.create(candidate.file.length()); int unrelated = platform.create(3);
        try {
            store.set(owned); platform.write(owned, candidate);
            PackageInstaller packages = context.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionInfo info = packages.getSessionInfo(owned);
            check(info != null && info.getMode() == PackageInstaller.SessionParams.MODE_FULL_INSTALL
                    && info.getAppPackageName().equals("au.local.blockops") && !info.isSealed(), "Incorrect real session configuration");
            if (android.os.Build.VERSION.SDK_INT >= 31) check(info.getRequireUserAction() == PackageInstaller.SessionParams.USER_ACTION_REQUIRED, "User action not required");
            try (PackageInstaller.Session session = packages.openSession(owned); InputStream in = session.openRead("base.apk")) {
                java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
                byte[] bytes = new byte[32768]; int n; long total = 0;
                while ((n = in.read(bytes)) != -1) { digest.update(bytes, 0, n); total += n; }
                check(HttpsUpdateTransport.hex(digest.digest()).equals(APK_SHA) && total == candidate.file.length(), "Session bytes differ from verified fixture");
            }
            InstalledApp installed = new InstalledApp("au.local.blockops", "0.10.0", 14, SIGNER, android.os.Build.VERSION.SDK_INT);
            AndroidUpdateInstaller adapter = new AndroidUpdateInstaller(context, store, () -> null, installed, new AndroidApkVerifier(context));
            check(adapter.reconcile(owned).phase.equals("idle") && store.id == null, "Real uncommitted recovery failed");
            check(packages.getSessionInfo(owned) == null && packages.getSessionInfo(unrelated) != null, "Real recovery touched unrelated session");
            store.set(unrelated); adapter.cancelOwned(unrelated);
            check(packages.getSessionInfo(unrelated) == null && store.id == null, "Real cancellation did not remove owned session");
            int invalid = platform.create(candidate.file.length());
            try {
                Release release = new Release(1, "v0.10.0", new Version(0, 10, 0), candidate.release.asset, zeros(64), "Bad digest");
                rejected(() -> platform.write(invalid, new Candidate(candidate.file, release)));
            } finally { platform.abandon(invalid); }
        } finally {
            // These two IDs were created by this test; never enumerate-and-abandon other sessions.
            if (platform.session(owned) != null) platform.abandon(owned);
            if (platform.session(unrelated) != null) platform.abandon(unrelated);
        }
    }
    private Intent status(int id, int status) {
        return new Intent("au.local.blockops.UPDATE_INSTALL_STATUS").setData(android.net.Uri.parse("blockops-update:" + id))
                .putExtra(PackageInstaller.EXTRA_SESSION_ID, id).putExtra(PackageInstaller.EXTRA_STATUS, status);
    }
    private static final class MemorySessionStore implements UpdatePorts.SessionStore {
        Integer id;
        boolean rejectSave;
        public Integer get() { return id; }
        public void set(Integer value) throws UpdatePorts.Failure {
            if (rejectSave) throw new UpdatePorts.Failure("store_failed", "Test durable write failure");
            id = value;
        }
    }
    private static final class ReceiverContext extends ContextWrapper implements UpdateInstallReceiver.Provider {
        final AndroidUpdateInstaller installer;
        ReceiverContext(Context context, AndroidUpdateInstaller installer) { super(context); this.installer = installer; }
        public Context getApplicationContext() { return this; }
        public AndroidUpdateInstaller updateInstaller() { return installer; }
    }
    private final class Rig {
        final MemorySessionStore store = new MemorySessionStore();
        final ScriptedPlatform platform = new ScriptedPlatform(store);
        final List<InstallEvent> events = new ArrayList<>();
        Activity foreground = activity();
        int inspections;
        boolean rejectInspection, rejectSecondInspection;
        final AndroidUpdateInstaller installer;
        Rig() throws Exception { installer = recreate(); installer.setListener(events::add); }
        AndroidUpdateInstaller recreate() {
            return new AndroidUpdateInstaller(context, store, () -> foreground,
                    new InstalledApp("au.local.blockops", "0.9.0", 13, SIGNER, android.os.Build.VERSION.SDK_INT),
                    (candidate, installed) -> {
                        inspections++;
                        if (rejectInspection || (rejectSecondInspection && inspections == 2)) throw new UpdatePorts.Failure("invalid_identity", "Rejected fixture");
                        return new AndroidApkVerifier(context).inspect(candidate, installed);
                    }, platform);
        }
    }
    private static final class ScriptedPlatform implements AndroidUpdateInstaller.Platform {
        final MemorySessionStore store;
        final Map<Integer, AndroidUpdateInstaller.SessionState> sessions = new HashMap<>();
        int next = 100, commitCalls, launches, removalQueries;long currentCode=13;
        Integer removing;
        final java.util.concurrent.CountDownLatch abandonStarted=new java.util.concurrent.CountDownLatch(1);
        boolean allowed = true, recordedBeforeSubmit, throwAfterSubmit, ignoreAbandon;
        Intent lastIntent;
        Runnable afterWrite = () -> {};
        Runnable afterSubmit = () -> {};
        ScriptedPlatform(MemorySessionStore store) { this.store = store; }
        public boolean allowed() { return allowed; }
        public int create(long size) { int id = next++; sessions.put(id, new AndroidUpdateInstaller.SessionState(false)); return id; }
        public void write(int id, Candidate candidate) { afterWrite.run(); }
        public void submit(int id, IntentSender sender) {
            recordedBeforeSubmit = store.id != null && store.id == id && sender != null;
            commitCalls++; sessions.put(id, new AndroidUpdateInstaller.SessionState(true));
            afterSubmit.run();
            if (throwAfterSubmit) throw new IllegalStateException("Ambiguous platform failure");
        }
        public AndroidUpdateInstaller.SessionState session(int id) {
            if(removing!=null&&removing==id&&--removalQueries<=0){sessions.remove(id);removing=null;}
            return sessions.get(id);
        }
        public void abandon(int id) { abandonStarted.countDown();if (!ignoreAbandon){if(removalQueries>0)removing=id;else sessions.remove(id);} }
        public long installedCode() { return currentCode; }
        public void launch(Activity activity, Intent intent) { launches++; lastIntent = intent; }
    }
    private Activity activity() {
        Activity[] value = new Activity[1];
        runner.runOnMainSync(() -> value[0] = new Activity());
        return value[0];
    }
    private static String zeros(int count) { return repeated('0', count); }
    private static String repeated(char value, int count) {
        char[] text = new char[count]; java.util.Arrays.fill(text, value); return new String(text);
    }
    // Coercive JSON field parsing, ambiguous integrity data, and relaxed bounds fail here.
    private void parseGithubJson() throws Exception {
        Release release = parse(metadata(), null);
        check(release.sha256.equals(SHA) && release.asset.name.equals("block-ops-test.apk"), "Wrong selected digest/APK");
        check(release.asset.uri.toString().equals(BASE + "block-ops-test.apk"), "Wrong selected URL");
        String sums = SHA + "  block-ops-test.apk\n";
        JSONObject withSum = metadata(); addChecksum(withSum, sums);
        check(parse(withSum, sums).sha256.equals(SHA), "Advertised matching checksum rejected");
        for (boolean nullDigest : new boolean[]{false, true}) {
            JSONObject fallback = metadata();
            if (nullDigest) apk(fallback).put("digest", JSONObject.NULL); else apk(fallback).remove("digest");
            addChecksum(fallback, sums);
            check(parse(fallback, sums).sha256.equals(SHA), "Missing/null digest fallback rejected");
        }
        JSONObject mismatch = metadata(); String wrong = zeros(64) + "  block-ops-test.apk\n";
        addChecksum(mismatch, wrong); rejected(() -> parse(mismatch, wrong));
        JSONObject rows = metadata(); addChecksum(rows, sums + sums); rejected(() -> parse(rows, sums + sums));
        for (Object digest : new Object[]{"sha256:bad", 12, false}) {
            JSONObject bad = metadata(); apk(bad).put("digest", digest); addChecksum(bad, sums);
            rejected(() -> parse(bad, sums));
        }
        JSONObject noDigest = metadata(); apk(noDigest).put("digest", JSONObject.NULL); rejected(() -> parse(noDigest, null));
        JSONObject duplicateSums = metadata(); addChecksum(duplicateSums, sums);
        duplicateSums.getJSONArray("assets").put(new JSONObject(duplicateSums.getJSONArray("assets").getJSONObject(1).toString()).put("id", 3));
        rejected(() -> parse(duplicateSums, sums));
        JSONObject foreign = metadata(); addChecksum(foreign, sums);
        foreign.getJSONArray("assets").getJSONObject(1).put("browser_download_url", "https://github.com/other/repo/releases/download/v0.10.0/SHA256SUMS");
        rejected(() -> parse(foreign, sums));
        for (String field : new String[]{"draft", "prerelease", "id"}) {
            JSONObject bad = metadata(); bad.put(field, "false"); rejected(() -> parse(bad, null));
        }
        for (String field : new String[]{"id", "size"}) {
            for (Object value : new Object[]{"3", 3.5, JSONObject.NULL, true}) {
                JSONObject bad = metadata(); apk(bad).put(field, value); rejected(() -> parse(bad, null));
            }
        }
        JSONObject duplicate = metadata(); duplicate.getJSONArray("assets").put(new JSONObject(apk(duplicate).toString()));
        rejected(() -> parse(duplicate, null));
        JSONObject duplicateApk = metadata(); duplicateApk.getJSONArray("assets").put(new JSONObject(apk(duplicateApk).toString()).put("id", 9));
        rejected(() -> parse(duplicateApk, null));
        JSONObject excessive = metadata();
        for (int i = 0; i < 256; i++) excessive.getJSONArray("assets").put(new JSONObject(apk(excessive).toString()).put("id", i + 2));
        rejected(() -> parse(excessive, null));
        JSONObject text = metadata(); text.put("body", "\u0001\u202e" + repeated('x', 900));
        String summary = parse(text, null).summary;
        check(summary.length() == 512 && !summary.contains("\u0001") && !summary.contains("\u202e"), "Unbounded/unsafe summary");
        JSONObject wrongBody = metadata(); wrongBody.put("body", 12); rejected(() -> parse(wrongBody, null));
    }
    // Real PackageManager archive parsing and current certificate extraction, not android.jar stubs.
    private void parseActualApk() throws Exception {
        Candidate candidate = fixture();
        InstalledApp prior = new InstalledApp("au.local.blockops", "0.9.0", 13, SIGNER, android.os.Build.VERSION.SDK_INT);
        ApkIdentity identity = new AndroidApkVerifier(context).inspect(candidate, prior);
        check(identity.packageName.equals("au.local.blockops") && identity.versionName.equals("0.10.0")
                && identity.versionCode == 14 && identity.signerSha256.equals(SIGNER) && identity.minSdk == 26,
                "Actual APK identity mismatch");
        rejected(() -> new AndroidApkVerifier(context).inspect(candidate,
                new InstalledApp("au.local.blockops", "0.10.0", 14, SIGNER, android.os.Build.VERSION.SDK_INT)));
        rejected(() -> new AndroidApkVerifier(context).inspect(candidate,
                new InstalledApp("au.local.blockops", "0.9.0", 13, zeros(64), android.os.Build.VERSION.SDK_INT)));
    }
    private Candidate fixture() throws Exception {
        File directory = new File(context.getCacheDir(), "updater-instrumentation");
        check(directory.isDirectory() || directory.mkdir(), "Cannot create private test fixtures");
        File file = new File(directory, "baseline.apk");
        try (InputStream in = runner.getContext().getAssets().open("baseline.apk"); OutputStream out = new FileOutputStream(file)) {
            byte[] buffer = new byte[32768]; int n; while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
        }
        Asset asset = new Asset(1, "block-ops-test.apk", URI.create(BASE + "block-ops-test.apk"), file.length(), "sha256:" + APK_SHA);
        return new Candidate(file, new Release(1, "v0.10.0", new Version(0, 10, 0), asset, APK_SHA, "Fixture"));
    }
    private JSONObject metadata() throws Exception {
        return new JSONObject().put("id", 1).put("tag_name", "v0.10.0").put("draft", false).put("prerelease", false)
                .put("body", "Release").put("assets", new JSONArray().put(new JSONObject().put("id", 1)
                        .put("name", "block-ops-test.apk").put("browser_download_url", BASE + "block-ops-test.apk")
                        .put("size", 3).put("digest", "sha256:" + SHA)));
    }
    private JSONObject apk(JSONObject metadata) throws Exception { return metadata.getJSONArray("assets").getJSONObject(0); }
    private void addChecksum(JSONObject metadata, String sums) throws Exception {
        metadata.getJSONArray("assets").put(new JSONObject().put("id", 2).put("name", "SHA256SUMS")
                .put("browser_download_url", BASE + "SHA256SUMS").put("size", sums.getBytes(StandardCharsets.UTF_8).length));
    }
    private Release parse(JSONObject metadata, String sums) throws Exception {
        UpdatePorts.Clock clock = new UpdatePorts.Clock() {
            public long wallMillis() { return System.currentTimeMillis(); }
            public long elapsedMillis() { return SystemClock.elapsedRealtime(); }
        };
        HttpsUpdateTransport transport = new HttpsUpdateTransport(url -> new Connection(url,
                (url.getHost().equals("api.github.com") ? metadata.toString() : sums).getBytes(StandardCharsets.UTF_8)), clock);
        return new GithubReleaseClient(transport).latest(new UpdateCancellation());
    }
    private static final class Connection extends HttpsURLConnection {
        private final byte[] bytes;
        Connection(URL url, byte[] bytes) { super(url); this.bytes = bytes; }
        public int getResponseCode() { return 200; }
        public InputStream getInputStream() { return new ByteArrayInputStream(bytes); }
        public String getHeaderField(String field) { return "Content-Length".equalsIgnoreCase(field) ? String.valueOf(bytes.length) : null; }
        public void connect() {}
        public void disconnect() {}
        public boolean usingProxy() { return false; }
        public String getCipherSuite() { return "TLS_FIXTURE"; }
        public Certificate[] getLocalCertificates() { return null; }
        public Certificate[] getServerCertificates() { return null; }
    }
    private interface Checked { void run() throws Exception; }
    private static void rejected(Checked action) throws Exception {
        try { action.run(); } catch (UpdatePorts.Failure expected) { return; }
        throw new AssertionError("Unsafe input accepted");
    }
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
}
