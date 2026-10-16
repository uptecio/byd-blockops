package au.local.blockops.updates;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.io.File;
import java.io.FileWriter;
import java.util.concurrent.Executors;
import au.local.blockops.BlockOpsApplication;
import static au.local.blockops.updates.UpdatePorts.*;
import static au.local.blockops.updates.UpdateModel.*;

/** Replaces the Application only under this instrumentation runner. */
public final class FixtureApplication extends BlockOpsApplication {
    static Bundle arguments;
    static Context testContext;
    private AndroidUpdateInstaller fixtureInstaller;
    private int activityCreations;
    private volatile Snapshot latest;
    private volatile Runnable submissionObserver;
    void observeSubmissionBoundary(){Runnable observer=submissionObserver;if(observer!=null)observer.run();}
    @Override public void onActivityCreated(android.app.Activity activity,Bundle state){super.onActivityCreated(activity,state);activityCreations++;}
    @Override protected UpdateController createUpdater(){
        if(arguments==null||!"acceptance".equals(arguments.getString("suite")))return super.createUpdater();
        try {
            String fixture=arguments.getString("fixture","valid"),mode=arguments.getString("mode","normal");
            Clock clock=new Clock(){public long wallMillis(){return System.currentTimeMillis();}public long elapsedMillis(){return SystemClock.elapsedRealtime();}};
            InstalledApp installed=AndroidApkVerifier.readInstalled(this);
            FixtureUpdateSource source=new FixtureUpdateSource(testContext,fixture,mode);
            HttpsUpdateTransport transport=new HttpsUpdateTransport(source,clock);
            UpdatePreferences prefs=new UpdatePreferences(this);AndroidApkVerifier verifier=new AndroidApkVerifier(this);
            File sentinel=new File(getFilesDir(),"updater-fixture-sentinel.txt");
            if("true".equals(arguments.getString("sentinel"))&&!sentinel.exists()){
                android.content.pm.PackageInstaller.SessionParams params=new android.content.pm.PackageInstaller.SessionParams(android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(getPackageName());int id=getPackageManager().getPackageInstaller().createSession(params);
                try(FileWriter out=new FileWriter(sentinel)){out.write(Integer.toString(id));}
            }
            fixtureInstaller=new AndroidUpdateInstaller(this,prefs,this::eligibleActivity,installed,verifier);
            File directory="storageFull".equals(mode)?new File(getFilesDir(),"updater-fixture-"+fixture+"-"+mode){@Override public long getUsableSpace(){return 0;}}:new File(getFilesDir(),"updater-fixture-"+fixture+"-"+mode);
            UpdateCandidateStore candidates=new UpdateCandidateStore(directory,transport);
            if("true".equals(arguments.getString("reset"))){
                if(prefs.get()!=null)throw new IllegalStateException("Resolve owned pending session before resetting a fixture");
                prefs.save(new SavedState(0,0,0,null));candidates.forget();
                File marker=new File(getFilesDir(),"updater-fixture-"+mode+".marker");if(marker.exists()&&!marker.delete())throw new IllegalStateException("Fixture marker reset failed");
            }
            Handler main=new Handler(Looper.getMainLooper());
            if("deathAtSubmission".equals(mode))submissionObserver=new Runnable(){
                private long started;
                public void run(){
                    try {
                        if(new File(getFilesDir(),"updater-fixture-"+mode+".marker").exists())return;
                        Integer id=prefs.get();Snapshot state=latest;
                        if(id==null||state==null||!"installing".equals(state.phase))return;
                        if(started==0)started=SystemClock.elapsedRealtime();
                        android.content.pm.PackageInstaller.SessionInfo session=getPackageManager().getPackageInstaller().getSessionInfo(id);
                        if(session!=null&&session.isSealed())main.post(()->recordObservation(latest,prefs,mode));
                        else if(SystemClock.elapsedRealtime()-started>30000)throw new IllegalStateException("Fixture never observed owned session sealed");
                    }catch(Failure failure){throw new IllegalStateException("Fixture session observation failed",failure);}
                }
            };
            return new UpdateController(installed,source,candidates,verifier,fixtureInstaller,prefs,clock,
                Executors.newSingleThreadExecutor(),main::post,state->{
                    latest=state;
                    dispatchUpdate(state);
                    recordObservation(state,prefs,mode);
                },Executors.newSingleThreadExecutor());
        }catch(Exception failure){throw new IllegalStateException("Fixture construction failed",failure);}
    }
    /** Main-thread publication; the instrumentation thread only polls the real sealed boundary. */
    private void recordObservation(Snapshot state,UpdatePreferences prefs,String mode){
        try {
            org.json.JSONArray sessions=new org.json.JSONArray();
            for(android.content.pm.PackageInstaller.SessionInfo session:getPackageManager().getPackageInstaller().getMySessions())sessions.put(session.getSessionId());
            Integer owned=prefs.get();
            android.content.pm.PackageInstaller.SessionInfo ownInfo=owned==null?null:getPackageManager().getPackageInstaller().getSessionInfo(owned);
            boolean sealed=ownInfo!=null&&ownInfo.isSealed();
            org.json.JSONObject event=new org.json.JSONObject().put("phase",state.phase).put("message",state.message)
                .put("downloaded",state.downloadedBytes).put("ownedSession",owned).put("ownedSealed",sealed).put("sessions",sessions).put("pid",android.os.Process.myPid()).put("activityCreations",activityCreations).put("elapsed",SystemClock.elapsedRealtime());
            File status=new File(getFilesDir(),"updater-fixture-status.json"),pending=new File(getFilesDir(),"updater-fixture-status.pending");
            try(FileWriter out=new FileWriter(pending)){out.write(event.toString());}
            if(!pending.renameTo(status))throw new IllegalStateException("Fixture status publication failed");
            try(FileWriter out=new FileWriter(new File(getFilesDir(),"updater-fixture-events.jsonl"),true)){out.write(event.toString()+"\n");}
            File marker=new File(getFilesDir(),"updater-fixture-"+mode+".marker");
            if("recreate".equals(mode)&&"downloading".equals(state.phase)&&state.downloadedBytes>0&&eligibleActivity()!=null&&marker.createNewFile())eligibleActivity().recreate();
            if("deathAtSubmission".equals(mode)&&"installing".equals(state.phase)&&owned!=null&&sealed&&marker.createNewFile())android.os.Process.killProcess(android.os.Process.myPid());
        }catch(Exception failure){throw new IllegalStateException("Fixture observation failed",failure);}
    }
    @Override public AndroidUpdateInstaller updateInstaller(){
        if(arguments==null||!"acceptance".equals(arguments.getString("suite")))return super.updateInstaller();
        updater();return fixtureInstaller;
    }
}
