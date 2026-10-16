package au.local.blockops.updates;

import java.io.File;
import java.net.URI;
import java.util.ArrayDeque;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
import static au.local.blockops.updates.UpdateModel.*;
import static au.local.blockops.updates.UpdatePorts.*;

/** Real coordinator with deterministic UI/worker queues and side-effect ports. */
public final class UpdaterControllerTest {
    static final long HOUR = 3600000;
    static final InstalledApp APP = new InstalledApp("au.local.blockops", "0.10.0", 14, UpdatePolicy.SIGNER_SHA256, 36);
    static Release release(long id) { return new Release(1,"v0.11.0",new Version(0,11,0),
        new Asset(id,"block-ops-test.apk",URI.create("https://github.com/uptecio/byd-blockops/releases/download/v0.11.0/block-ops-test.apk"),100,"sha256:" + "a".repeat(64)),"a".repeat(64),"Update"); }
    public static void main(String[] args) throws Exception {
        if(args.length>0){UpdaterControllerTest.class.getDeclaredMethod(args[0]).invoke(null);System.out.println("PASS "+args[0]);return;}
        automaticHomeDiscovery(); sixHourCache(); manualThirtySecondFloor(); failureFifteenMinuteBackoff(); serverRetryWins();
        clockRollback(); laterIsSessionOnly(); cancelGeneration(); assetChangedNeedsConsent(); recreationIsNotBackground();
        invalidCandidateForgotten(); installConsent(); asynchronousCancellation(); retryBound(); callbackBeforeCommitReturns();
        rollbackAutomaticCache(); checkDuringInitialization(); installRevalidationFailure(); completedCandidateSurvivesDeparture();
        terminalDuringCancel();staleSubmitFailure();invalidRecoveredCandidate();pauseDuringInstall();downloadRetryDeadline();
        pendingSessionFailureRecovery();startupTerminalWins();immediateDownloadCoalesces();stagingCancelBeforeGate();uncertainSubmitCancellation();
        laterIsReleaseSpecific();laterBeforeSubmission();nativePresentation();System.out.println("PASS controller (32 cases)");
    }
    static void nativePresentation() throws Exception {
        // Reflection lets the absent production formatter/query fail as explicit behavior gaps.
        java.lang.reflect.Method text;
        try { text=Class.forName("au.local.blockops.updates.UpdatePresentation").getMethod("text",Snapshot.class,String.class); }
        catch (ClassNotFoundException absent) {throw new AssertionError("Native presentation has no tested summary/progress/reopen formatter",absent);}
        java.lang.reflect.Method summary=UpdateController.class.getMethod("releaseSummary");
        Rig r=new Rig(new SavedState(0,0,0,null),1800000000000L,false);
        yes(summary.invoke(r.c).equals(""));
        r.next=new Release(1,"v0.11.0",new Version(0,11,0),release(1).asset,"a".repeat(64),"<plain>"+"x".repeat(900));
        r.c.home(true); r.c.foreground(true); r.drain();
        String bounded=(String)summary.invoke(r.c);
        eq(bounded.length(),512); yes(bounded.startsWith("<plain>"));
        String available=(String)text.invoke(null,r.c.snapshot(),bounded);
        yes(available.contains("Installed: 0.10.0")); yes(available.contains("Available: 0.11.0"));
        yes(available.contains("Download size: 100 bytes")); yes(available.contains(bounded));
        r.c.download(); r.worker.run(); r.ui.run();
        yes(r.c.snapshot().phase.equals("downloading"));
        String progress=(String)text.invoke(null,r.c.snapshot(),bounded);
        yes(progress.contains("0 / 100 bytes (0%)"));
        r.worker.run(); r.ui.run();
        yes(r.c.snapshot().phase.equals("ready"));
        String ready=(String)text.invoke(null,r.c.snapshot(),bounded);
        yes(ready.contains("Android may close the game")); yes(ready.contains("reopen"));
        for(int minor:new int[]{9,10}){
            Rig current=new Rig(new SavedState(0,0,0,null),1800000000000L,false);
            current.next=new Release(1,"v0."+minor+".0",new Version(0,minor,0),release(1).asset,"a".repeat(64),"Old release");
            current.c.home(true);current.c.foreground(true);current.drain();
            String rendered=(String)text.invoke(null,current.c.snapshot(),summary.invoke(current.c));
            yes(rendered.contains("up to date"));yes(!rendered.contains("Available:"));
            yes(!rendered.contains("Old release"));
        }
        System.out.println("PASS nativePresentation");
    }
    // Later must revoke both verification and queued submission, leaving an explicit retry.
    static void laterBeforeSubmission() {
        for (boolean afterVerification : new boolean[]{false,true}) {
            Rig r = ready();
            r.c.install();
            if (afterVerification) {
                r.worker.run(); r.ui.run();
                yes(r.c.snapshot().phase.equals("installing"));
            }
            r.c.dismiss(); r.drain();
            eq(r.commits,0); eq(r.confirms,0);
            yes(r.c.snapshot().phase.equals("ready"));
            r.c.install(); r.drain(); eq(r.commits,1);
        }
        Rig recovered = new Rig(new SavedState(0,0,0,null),1800000000000L,false);
        recovered.recorded=7;
        recovered.drain(); recovered.c.home(true); recovered.c.foreground(true);
        recovered.c.dismiss(); recovered.c.home(false); recovered.c.home(true); recovered.drain();
        yes(recovered.c.snapshot().phase.equals("installing"));
        eq(recovered.recorded,7); eq(recovered.commits,0); eq(recovered.confirms,0);
        recovered.c.cancel(); recovered.drain(); yes(recovered.recorded==null);
        System.out.println("PASS laterBeforeSubmission");
    }
    // Missing lifecycle scheduling must fail without a direct check() call.
    static void automaticHomeDiscovery() {
        for (boolean homeBeforeInitialization : new boolean[]{false,true}) {
            Rig r = new Rig(new SavedState(0,0,0,null),1800000000000L,false);
            if (!homeBeforeInitialization) r.drain();
            r.c.home(true);
            r.c.foreground(true);
            r.drain();
            eq(r.requests,1);
            yes(r.c.snapshot().phase.equals("available"));
            eq(r.downloads,0);
            r.c.home(false); r.c.home(true); r.drain(); eq(r.requests,1);
            r.advance(6*HOUR-1);
            r.c.foreground(false); r.c.foreground(true); r.drain(); eq(r.requests,1);
            r.advance(1);
            r.c.foreground(false); r.c.foreground(true); r.drain(); eq(r.requests,2);
        }
        Rig failed = new Rig(new SavedState(0,0,0,null),1800000000000L,false);
        failed.failure = new Failure("network","Try again");
        failed.c.foreground(true); failed.c.home(true); failed.drain(); eq(failed.requests,1);
        failed.advance(899999);
        failed.c.home(false); failed.c.home(true); failed.drain(); eq(failed.requests,1);
        failed.advance(1);
        failed.c.home(false); failed.c.home(true); failed.drain(); eq(failed.requests,2);
        Rig exited = new Rig(new SavedState(0,0,0,null),1800000000000L,false);
        exited.c.foreground(true); exited.c.home(true); exited.c.home(false); exited.drain();
        eq(exited.requests,0);
        System.out.println("PASS automaticHomeDiscovery");
    }
    // Export real lifecycle/check/dismissal results for the production JavaScript adapter test.
    static void presentationSnapshots() {
        for (int minor : new int[]{9,10,11}) {
            Rig r=new Rig(new SavedState(0,0,0,null),1800000000000L,false);
            r.next=new Release(1,"v0."+minor+".0",new Version(0,minor,0),release(1).asset,"a".repeat(64),"Release summary");
            r.c.home(true); r.c.foreground(true); r.drain();
            emit("version-"+minor,r.c.snapshot());
        }
        Rig pending=new Rig(new SavedState(0,0,0,null),1800000000000L,false);
        pending.recorded=7; pending.drain(); pending.c.home(true); pending.c.foreground(true);
        pending.c.dismiss(); pending.c.home(false); pending.c.home(true); pending.drain();
        emit("pending-dismissed",pending.c.snapshot());
    }
    static void emit(String label,Snapshot s) {
        System.out.println("SNAPSHOT "+label+" {\"revision\":"+s.revision+",\"phase\":\""+s.phase+"\",\"installedVersion\":\""+s.installedVersion
            +"\",\"availableVersion\":"+(s.availableVersion==null?"null":"\""+s.availableVersion+"\"")+",\"totalBytes\":"+s.totalBytes
            +",\"downloadedBytes\":"+s.downloadedBytes+",\"message\":\""+s.message+"\",\"dismissed\":"+s.dismissed+"}");
    }
    static void pendingSessionFailureRecovery(){
        Rig r=ready();r.c.install();r.drain();r.cancelFailure=new Failure("install_failed","Removal timed out");r.c.cancel();r.drain();
        yes(r.c.snapshot().phase.equals("installing"));eq(r.cancels,1);r.cancelFailure=null;r.c.cancel();r.drain();
        eq(r.cancels,2);yes(r.c.snapshot().phase.equals("ready"));r.c.install();r.drain();eq(r.commits,2);
        r.confirmFailure=new Failure("install_failed","Cannot launch confirmation");r.events.accept(new InstallEvent(7,"confirmation","Confirm"));r.drain();
        yes(r.c.snapshot().phase.equals("installing"));r.c.cancel();r.drain();yes(r.c.snapshot().phase.equals("ready"));
        Rig vanished=ready();vanished.c.install();vanished.drain();vanished.cancelFailure=new Failure("install_failed","Timeout");
        vanished.c.cancel();vanished.drain();vanished.recorded=null;vanished.c.cancel();vanished.drain();
        eq(vanished.cancels,1);yes(vanished.c.snapshot().phase.equals("ready"));
    }
    static void startupTerminalWins(){
        Rig r=new Rig(new SavedState(0,0,0,null),1800000000000L,false);r.recorded=7;r.candidate=new Candidate(new File("fixture"),release(1));
        r.onInspect=()->{r.recorded=null;r.events.accept(new InstallEvent(7,"idle","Resolved"));r.ui.run();};
        r.drain();yes(!r.c.snapshot().phase.equals("installing"));r.c.home(true);r.c.foreground(true);r.check(true);eq(r.requests,1);
    }
    static void immediateDownloadCoalesces(){
        Rig r=new Rig();r.check(true);r.c.download();r.c.download();r.drain();eq(r.requests,2);eq(r.downloads,1);
        yes(r.c.snapshot().phase.equals("ready"));r.check(true);eq(r.requests,2);
        Rig limited=new Rig();limited.check(true);limited.failure=new Failure("limited","Wait",limited.wall+HOUR);
        limited.c.download();limited.drain();eq(limited.requests,2);limited.c.download();limited.drain();eq(limited.requests,2);
    }
    static Rig ready(){Rig r=new Rig();r.check(true);r.advance(30000);r.c.download();r.drain();return r;}
    static void stagingCancelBeforeGate(){
        Rig r=ready();r.onStage=()->{r.c.cancel();r.c.install();r.c.check(true);};r.c.install();r.drain();
        eq(r.commits,0);eq(r.requests,2);yes(r.c.snapshot().phase.equals("ready"));eq(r.confirms,0);
    }
    static void uncertainSubmitCancellation(){
        Rig r=ready();r.onSubmitted=()->{r.c.cancel();r.events.accept(new InstallEvent(7,"confirmation","Confirm"));};
        r.submitFailure=new Failure("install_failed","Uncertain submission");r.c.install();r.drain();
        eq(r.commits,1);eq(r.cancels,1);eq(r.confirms,0);yes(r.recorded==null);yes(r.c.snapshot().phase.equals("ready"));
        Rig failure=ready();failure.onSubmitted=failure.c::cancel;failure.cancelFailure=new Failure("install_failed","Timed out");
        failure.c.install();failure.drain();yes(failure.c.snapshot().phase.equals("installing"));eq(failure.cancels,1);
        failure.cancelFailure=null;failure.c.cancel();failure.drain();eq(failure.cancels,2);yes(failure.c.snapshot().phase.equals("ready"));
    }
    static void sixHourCache() {
        Rig r=new Rig(); r.check(false); eq(r.requests,1); eq(r.downloads,0);
        r.advance(6*HOUR-1); r.check(false); eq(r.requests,1);
        r.advance(1); r.check(false); eq(r.requests,2);
        Rig restarted=new Rig(r.saved,r.wall); restarted.check(false); eq(restarted.requests,0);
        System.out.println("PASS sixHourCache");
    }
    static void manualThirtySecondFloor() {
        Rig r=new Rig(); r.check(true); r.advance(29999); r.check(true); eq(r.requests,1);
        r.advance(1); r.check(true); eq(r.requests,2); System.out.println("PASS manualThirtySecondFloor");
    }
    static void failureFifteenMinuteBackoff() {
        Rig r=new Rig(); r.failure=new Failure("network","Try again"); r.check(false);
        r.advance(899999); r.check(false); eq(r.requests,1); r.advance(1); r.check(false); eq(r.requests,2);
        r.advance(30000); r.check(true); eq(r.requests,3); System.out.println("PASS failureFifteenMinuteBackoff");
    }
    static void serverRetryWins() {
        Rig r=new Rig(); r.failure=new Failure("limited","Wait",r.wall+8*HOUR); r.check(false);
        r.advance(8*HOUR-1); r.check(false); r.check(true); eq(r.requests,1);
        r.advance(1); r.check(true); eq(r.requests,2); System.out.println("PASS serverRetryWins");
    }
    static void clockRollback() {
        Rig r=new Rig(); r.check(true); r.wall-=HOUR; r.advance(29999); r.check(true); eq(r.requests,1);
        r.advance(1); r.check(true); eq(r.requests,2);
        Rig corrupt=new Rig(new SavedState(Long.MAX_VALUE,-1,Long.MAX_VALUE,release(1)));
        corrupt.check(false); eq(corrupt.requests,1);
        Rig future=new Rig(new SavedState(2000000000000L,0,0,release(1))); future.check(false); eq(future.requests,1);
        System.out.println("PASS clockRollback");
    }
    static void laterIsSessionOnly() {
        Rig r=new Rig(); r.check(true); r.c.dismiss(); r.drain(); yes(r.c.snapshot().dismissed);
        Rig restart=new Rig(r.saved); yes(!restart.c.snapshot().dismissed);
        r.advance(30000); r.check(true); yes(!r.c.snapshot().dismissed); System.out.println("PASS laterIsSessionOnly");
    }
    static void laterIsReleaseSpecific(){
        Rig r=new Rig();r.check(false);r.c.dismiss();r.drain();r.advance(6*HOUR);r.check(false);yes(r.c.snapshot().dismissed);
        r.next=new Release(2,"v0.12.0",new Version(0,12,0),release(2).asset,"a".repeat(64),"New release");
        r.advance(6*HOUR);r.check(false);yes(!r.c.snapshot().dismissed);
    }
    static void cancelGeneration() {
        Rig r=new Rig(); r.c.check(true); r.ui.run(); r.worker.run(); // old completion is queued
        r.c.cancel(); r.c.home(false); r.ui.run();
        yes(!r.c.snapshot().phase.equals("available")); r.drain(); eq(r.downloads,0);
        r.c.home(true); r.drain(); r.advance(30000); r.check(true);
        r.c.download(); r.ui.run(); r.c.home(false); r.ui.run(); r.drain(); eq(r.downloads,0);
        System.out.println("PASS cancelGeneration");
    }
    static void assetChangedNeedsConsent() {
        for(int change=0;change<4;change++){
            Rig r=new Rig();r.check(true);Release original=r.next;String hash=(change==3?"b":"a").repeat(64);
            Asset changed=new Asset(change==0?2:1,original.asset.name,
                change==1?URI.create(original.asset.uri+"?revision=2"):original.asset.uri,change==2?101:100,"sha256:"+hash);
            r.next=new Release(1,original.tag,original.version,changed,hash,"");r.advance(30000);r.c.download();r.drain();
            eq(r.downloads,0);yes(r.c.snapshot().phase.equals("available"));
            r.advance(30000);r.c.download();r.drain();eq(r.downloads,1);yes(r.c.snapshot().phase.equals("ready"));
        }
        System.out.println("PASS assetChangedNeedsConsent");
    }
    static void recreationIsNotBackground() {
        Rig r=new Rig(); r.check(true); r.advance(30000); r.c.download(); r.ui.run();
        // Activity replacement changes observers only; foreground/Home remain true.
        r.c.foreground(true); r.c.home(true); r.drain(); eq(r.downloads,1);
        r.c.foreground(false); r.drain(); yes(r.c.snapshot().phase.equals("ready"));
        System.out.println("PASS recreationIsNotBackground");
    }
    static void invalidCandidateForgotten() {
        Rig r=new Rig(); r.check(true); r.bad=true; r.advance(30000); r.c.download(); r.drain();
        yes(r.c.snapshot().phase.equals("error")); yes(r.candidate==null); r.c.install(); r.drain(); eq(r.commits,0);
    }
    static void invalidRecoveredCandidate(){
        Rig r=new Rig(new SavedState(0,0,0,null),1800000000000L,false);r.candidate=new Candidate(new File("invalid"),release(1));r.bad=true;
        r.drain();r.c.home(true);r.c.foreground(true);r.drain();yes(!r.c.snapshot().phase.equals("ready"));
        yes(r.candidate==null);r.c.install();r.drain();eq(r.commits,0);
    }
    static void pauseDuringInstall(){
        Rig r=new Rig();r.check(true);r.advance(30000);r.c.download();r.drain();
        r.c.install();r.c.activityDetached();r.drain();eq(r.commits,0);yes(r.c.snapshot().phase.equals("ready"));
        r.c.foreground(true);r.c.install();r.drain();eq(r.commits,1);r.c.activityDetached();
        r.events.accept(new InstallEvent(7,"confirmation","Confirm"));r.drain();yes(!r.c.canConfirmInstall());eq(r.confirms,0);
        r.c.foreground(true);yes(r.c.canConfirmInstall());r.c.install();r.drain();eq(r.confirms,1);
    }
    static void installConsent() {
        Rig r=new Rig(); r.check(true); r.advance(30000); r.c.download(); r.drain();
        r.allowed=false; r.c.install(); r.drain(); yes(r.c.snapshot().phase.equals("permission"));
        r.c.openPermissionSettings(); r.drain(); eq(r.settings,1); r.allowed=true;
        r.c.foreground(false); r.c.foreground(true); r.drain(); eq(r.commits,0);
        r.c.install(); r.c.install(); r.drain(); eq(r.commits,1);
        r.events.accept(new InstallEvent(7,"confirmation","Confirm")); r.drain(); eq(r.confirms,1);
        r.c.foreground(false); r.events.accept(new InstallEvent(7,"confirmation","Confirm")); r.drain(); eq(r.confirms,1);
        yes(!r.c.canConfirmInstall());r.c.foreground(true);r.drain();yes(r.c.canConfirmInstall());
        r.c.install();r.drain();eq(r.confirms,2);eq(r.commits,1);yes(!r.c.canConfirmInstall());
    }
    static void callbackBeforeCommitReturns(){
        Rig r=new Rig();r.check(true);r.advance(30000);r.c.download();r.drain();
        r.terminalInCommit=true;r.c.install();r.drain();yes(r.c.snapshot().phase.equals("idle"));
    }
    static void terminalDuringCancel(){
        Rig r=new Rig();r.check(true);r.advance(30000);r.c.download();r.drain();r.c.install();r.drain();
        r.terminalInCancel=true;r.c.cancel();r.drain();yes(r.c.snapshot().phase.equals("idle"));
    }
    static void staleSubmitFailure(){
        Rig r=new Rig();r.check(true);r.advance(30000);r.c.download();r.drain();
        r.commitFailure=new Failure("install_failed","Old failure");r.c.install();r.ui.run();r.worker.run();r.ui.run();r.worker.run();
        r.c.cancel();r.advance(30000);r.c.check(true);r.ui.run();yes(r.c.snapshot().phase.equals("installing"));r.drain();
        eq(r.requests,2);yes(r.c.snapshot().phase.equals("ready"));
        yes(!r.c.snapshot().message.equals("Old failure"));
    }
    static void downloadRetryDeadline(){
        Rig r=new Rig();r.check(true);r.advance(30000);r.downloadFailure=new Failure("limited","Wait",r.wall+HOUR);
        r.c.download();r.drain();eq(r.requests,2);r.advance(HOUR-1);r.check(true);eq(r.requests,2);
        r.advance(1);r.check(true);eq(r.requests,3);
    }
    static void rollbackAutomaticCache(){
        Rig r=new Rig();r.check(false);r.wall-=HOUR;r.elapsed+=30000;r.check(false);eq(r.requests,2);
        Rig failure=new Rig();failure.failure=new Failure("network","Retry");failure.check(false);failure.wall-=HOUR;
        failure.elapsed+=899999;failure.check(false);eq(failure.requests,1);failure.elapsed++;failure.check(false);eq(failure.requests,2);
    }
    static void checkDuringInitialization(){
        Rig r=new Rig(new SavedState(0,0,0,null),1800000000000L,false);
        r.c.home(true);r.c.foreground(true);r.c.check(false);r.drain();eq(r.requests,1);
    }
    static void installRevalidationFailure(){
        Rig r=new Rig();r.check(true);r.advance(30000);r.c.download();r.drain();
        r.commitFailure=new Failure("invalid_identity","Invalid APK");r.c.install();r.drain();
        yes(r.candidate==null);yes(r.c.snapshot().phase.equals("error"));int prior=r.commits;r.c.install();r.drain();eq(r.commits,prior);
    }
    static void completedCandidateSurvivesDeparture(){
        Rig r=new Rig();r.check(true);r.advance(30000);r.c.download();r.ui.run();r.worker.run();r.ui.run();r.worker.run();
        // File completed, but its UI completion is still queued when Home is left.
        yes(r.candidate!=null);r.c.home(false);r.drain();r.c.home(true);r.drain();
        yes(r.c.snapshot().phase.equals("ready"));eq(r.downloads,1);
        r.c.install();r.drain();r.events.accept(new InstallEvent(7,"idle","Review update status"));r.drain();
        r.advance(30000);r.check(true);yes(r.c.snapshot().phase.equals("ready"));eq(r.downloads,1);
    }
    static void retryBound(){
        Rig r=new Rig();r.failure=new Failure("limited","Wait",r.wall+8*24*HOUR);r.check(true);
        eq(r.saved.serverRetryUntilWallMillis,r.wall+7*24*HOUR);
        r.advance(7*24*HOUR-1);r.check(true);r.check(false);eq(r.requests,1);
        r.advance(1);r.check(true);eq(r.requests,2);
        Rig rollback=new Rig();rollback.failure=new Failure("limited","Wait",rollback.wall+HOUR);rollback.check(true);
        rollback.wall-=2*HOUR;rollback.elapsed+=HOUR-1;rollback.check(true);eq(rollback.requests,1);
        rollback.elapsed++;rollback.check(true);eq(rollback.requests,2);
    }
    static void asynchronousCancellation() throws Exception {
        UpdateCancellation token=new UpdateCancellation();Queue cleanup=new Queue();int[] closes={0};
        token.register(()->closes[0]++);token.cancel(cleanup);eq(closes[0],0);
        try{token.check();throw new AssertionError("Not cancelled");}catch(Failure expected){}
        token.cancel(cleanup);cleanup.run();eq(closes[0],1);
        token.register(()->closes[0]++);eq(closes[0],2);
        java.util.concurrent.CountDownLatch read=new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch started=new java.util.concurrent.CountDownLatch(1);
        UpdateCancellation blocking=new UpdateCancellation();blocking.register(()->read.countDown());
        Thread reader=new Thread(()->{started.countDown();try{read.await();}catch(InterruptedException e){throw new AssertionError(e);}});
        reader.start();started.await();blocking.cancel(cleanup);yes(reader.isAlive());cleanup.run();reader.join(1000);yes(!reader.isAlive());
        System.out.println("PASS asynchronousCancellation");
    }
    static void eq(long a,long b) { if(a!=b)throw new AssertionError(a+" != "+b); }
    static void yes(boolean b) { if(!b)throw new AssertionError(); }
    static final class Queue implements Executor {
        final ArrayDeque<Runnable> tasks=new ArrayDeque<>(); public void execute(Runnable r){tasks.add(r);}
        void run(){ while(!tasks.isEmpty())tasks.remove().run(); }
    }
    static final class Rig implements Clock, CandidateStore, Installer {
        final Queue ui=new Queue(),worker=new Queue(); long wall=1800000000000L,elapsed=1000;
        int requests,downloads,commits,confirms,settings,cancels; boolean bad,allowed=true,terminalInCommit,terminalInCancel; Release next=release(1);
        Integer recorded;Runnable onInspect=()->{},onStage=()->{},onSubmitted=()->{};
        SavedState saved; Candidate candidate; Failure failure,commitFailure,downloadFailure,cancelFailure,confirmFailure,submitFailure; Consumer<InstallEvent> events;
        final UpdateController c;
        Rig(){this(new SavedState(0,0,0,null));}
        Rig(SavedState initial){this(initial,1800000000000L);}
        Rig(SavedState initial,long now){this(initial,now,true);}
        Rig(SavedState initial,long now,boolean initialize){wall=now;saved=initial; c=new UpdateController(APP,t->{t.check();requests++;if(failure!=null)throw failure;return next;},this,
            (a,i)->{onInspect.run();if(bad)throw new Failure("integrity","Invalid update");return new ApkIdentity(i.packageName,"0.11.0",15,i.signerSha256,26);},
            this,new StateStore(){public SavedState load(){return saved;}public void save(SavedState s){saved=s;}},this,worker,ui,s->{},worker); if(initialize){drain(); c.home(true);c.foreground(true);}}
        void drain(){for(int i=0;i<20&&(!ui.tasks.isEmpty()||!worker.tasks.isEmpty());i++){ui.run();worker.run();}ui.run();}
        void check(boolean manual){c.check(manual);drain();} void advance(long ms){wall+=ms;elapsed+=ms;}
        public long wallMillis(){return wall;} public long elapsedMillis(){return elapsed;}
        public Candidate download(Release r,UpdateCancellation t,Progress p)throws Failure {t.check();downloads++;if(downloadFailure!=null)throw downloadFailure;p.onBytes(100,100);return candidate=new Candidate(new File("fixture"),r);}
        public Candidate load(){return candidate;} public void deletePartial(){} public void forget(){candidate=null;}
        public boolean allowed(){return allowed;} public void openPermissionSettings(){settings++;}
        public int commit(Candidate c,UpdateCancellation cancellation)throws Failure{cancellation.check();onStage.run();cancellation.check();commits++;if(commitFailure!=null)throw commitFailure;recorded=7;onSubmitted.run();if(submitFailure!=null)throw submitFailure;if(terminalInCommit){recorded=null;events.accept(new InstallEvent(7,"idle","Installed"));}return 7;}
        public void confirm(int id)throws Failure{eq(id,7);if(confirmFailure!=null)throw confirmFailure;confirms++;}
        public InstallEvent reconcile(Integer id){return recorded==null?new InstallEvent(-1,"idle",""):new InstallEvent(recorded,"installing","Pending");}
        public void cancelOwned(int id)throws Failure{cancels++;if(cancelFailure!=null)throw cancelFailure;recorded=null;if(terminalInCancel)events.accept(new InstallEvent(id,"idle","Resolved"));}
        public void setListener(Consumer<InstallEvent> l){events=l;}
    }
}
