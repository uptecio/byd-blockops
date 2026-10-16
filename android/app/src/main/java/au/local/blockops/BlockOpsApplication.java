package au.local.blockops;

import android.app.Activity;
import android.app.Application;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.io.File;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import au.local.blockops.updates.*;
import static au.local.blockops.updates.UpdatePorts.*;
import static au.local.blockops.updates.UpdateModel.*;

/** Owns updater state across Activity replacement. Home integration is supplied by MainActivity. */
public class BlockOpsApplication extends Application implements Application.ActivityLifecycleCallbacks,UpdateInstallReceiver.Provider {
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Set<Listener> observers=new LinkedHashSet<>();
    private UpdateController updater;
    private AndroidUpdateInstaller installer;
    private ExecutorService worker,cleanup;
    private volatile Activity eligible;
    private Activity resumed;
    private int started;
    private boolean home;
    @Override public void onCreate(){super.onCreate();registerActivityLifecycleCallbacks(this);}
    public synchronized UpdateController updater(){if(updater==null)updater=createUpdater();return updater;}
    @Override public AndroidUpdateInstaller updateInstaller(){updater();return installer;}
    protected UpdateController createUpdater(){
        try{
            PackageInfo info=getPackageManager().getPackageInfo(getPackageName(),0);
            InstalledApp installed=new InstalledApp(getPackageName(),info.versionName,Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode,
                UpdatePolicy.SIGNER_SHA256,Build.VERSION.SDK_INT);
            Clock clock=new Clock(){public long wallMillis(){return System.currentTimeMillis();}public long elapsedMillis(){return SystemClock.elapsedRealtime();}};
            HttpsUpdateTransport transport=new HttpsUpdateTransport(url->(HttpsURLConnection)url.openConnection(),clock);
            UpdatePreferences prefs=new UpdatePreferences(this);AndroidApkVerifier verifier=new AndroidApkVerifier(this);
            installer=new AndroidUpdateInstaller(this,prefs,this::eligibleActivity,installed,verifier);
            worker=Executors.newSingleThreadExecutor(r->new Thread(r,"updater-worker"));
            cleanup=Executors.newSingleThreadExecutor(r->new Thread(r,"updater-cleanup"));
            return new UpdateController(installed,new GithubReleaseClient(transport),new UpdateCandidateStore(new File(getFilesDir(),"updater-v1"),transport),
                verifier,installer,prefs,clock,worker,main::post,this::dispatchUpdate,cleanup);
        }catch(android.content.pm.PackageManager.NameNotFoundException impossible){throw new IllegalStateException("Installed app unavailable",impossible);}
    }
    /** Must be called on main thread; close is safe from any thread and suppresses queued deliveries. */
    public AutoCloseable observeUpdates(Listener observer){
        UpdateController controller=updater();synchronized(observers){observers.add(observer);}
        main.post(()->{synchronized(observers){if(observers.contains(observer))observer.onState(controller.snapshot());}});
        return ()->{synchronized(observers){observers.remove(observer);}};
    }
    protected final void dispatchUpdate(Snapshot snapshot){
        Listener[] copy;synchronized(observers){copy=observers.toArray(new Listener[0]);}
        for(Listener observer:copy){synchronized(observers){if(observers.contains(observer))observer.onState(snapshot);}}
    }
    /** MainActivity reports trusted local Home visibility. Stale Activities cannot change eligibility. */
    public void setHome(Activity activity,boolean visible){
        if(activity!=resumed)return;home=visible;eligible=visible?activity:null;updater().home(visible);
    }
    /** Nonblocking supplier; never waits for main-thread lifecycle work. */
    public Activity eligibleActivity(){return eligible;}
    @Override public void onActivityStarted(Activity activity){started++;updater().foreground(true);if(resumed==null)updater().activityDetached();}
    @Override public void onActivityResumed(Activity activity){resumed=activity;eligible=home?activity:null;updater().foreground(true);}
    @Override public void onActivityPaused(Activity activity){if(resumed==activity){eligible=null;resumed=null;updater().activityDetached();}}
    @Override public void onActivityStopped(Activity activity){
        started=Math.max(0,started-1);
        if(started==0&&!activity.isChangingConfigurations()){eligible=null;home=false;updater().foreground(false);updater().home(false);}
    }
    @Override public void onActivityDestroyed(Activity activity){if(resumed==activity){eligible=null;resumed=null;updater().activityDetached();}}
    @Override public void onActivityCreated(Activity activity,Bundle state){}
    @Override public void onActivitySaveInstanceState(Activity activity,Bundle state){}
    @Override public void onTerminate(){unregisterActivityLifecycleCallbacks(this);if(updater!=null)updater.close();if(worker!=null)worker.shutdown();if(cleanup!=null)cleanup.shutdown();super.onTerminate();}
}
