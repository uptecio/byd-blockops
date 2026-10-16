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
        sixHourCache(); manualThirtySecondFloor(); failureFifteenMinuteBackoff(); serverRetryWins();
        clockRollback(); laterIsSessionOnly(); cancelGeneration(); assetChangedNeedsConsent(); recreationIsNotBackground();
        invalidCandidateForgotten(); installConsent(); asynchronousCancellation(); retryBound(); callbackBeforeCommitReturns();
        rollbackAutomaticCache(); checkDuringInitialization(); installRevalidationFailure(); completedCandidateSurvivesDeparture();
        terminalDuringCancel();staleSubmitFailure();invalidRecoveredCandidate();pauseDuringInstall();downloadRetryDeadline();
        System.out.println("PASS controller (23 cases)");
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
        r.c.cancel();r.advance(30000);r.c.check(true);r.ui.run();yes(r.c.snapshot().phase.equals("checking"));r.drain();
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
        int requests,downloads,commits,confirms,settings; boolean bad,allowed=true,terminalInCommit,terminalInCancel; Release next=release(1);
        SavedState saved; Candidate candidate; Failure failure,commitFailure,downloadFailure; Consumer<InstallEvent> events;
        final UpdateController c;
        Rig(){this(new SavedState(0,0,0,null));}
        Rig(SavedState initial){this(initial,1800000000000L);}
        Rig(SavedState initial,long now){this(initial,now,true);}
        Rig(SavedState initial,long now,boolean initialize){wall=now;saved=initial; c=new UpdateController(APP,t->{t.check();requests++;if(failure!=null)throw failure;return next;},this,
            (a,i)->{if(bad)throw new Failure("integrity","Invalid update");return new ApkIdentity(i.packageName,"0.11.0",15,i.signerSha256,26);},
            this,new StateStore(){public SavedState load(){return saved;}public void save(SavedState s){saved=s;}},this,worker,ui,s->{},worker); if(initialize){drain(); c.home(true);c.foreground(true);drain();}}
        void drain(){for(int i=0;i<20&&(!ui.tasks.isEmpty()||!worker.tasks.isEmpty());i++){ui.run();worker.run();}ui.run();}
        void check(boolean manual){c.check(manual);drain();} void advance(long ms){wall+=ms;elapsed+=ms;}
        public long wallMillis(){return wall;} public long elapsedMillis(){return elapsed;}
        public Candidate download(Release r,UpdateCancellation t,Progress p)throws Failure {t.check();downloads++;if(downloadFailure!=null)throw downloadFailure;p.onBytes(100,100);return candidate=new Candidate(new File("fixture"),r);}
        public Candidate load(){return candidate;} public void deletePartial(){} public void forget(){candidate=null;}
        public boolean allowed(){return allowed;} public void openPermissionSettings(){settings++;}
        public int commit(Candidate c)throws Failure{commits++;if(commitFailure!=null)throw commitFailure;if(terminalInCommit)events.accept(new InstallEvent(7,"idle","Installed"));return 7;} public void confirm(int id){eq(id,7);confirms++;}
        public InstallEvent reconcile(Integer id){return new InstallEvent(-1,"idle","");} public void cancelOwned(int id){if(terminalInCancel)events.accept(new InstallEvent(id,"idle","Resolved"));}
        public void setListener(Consumer<InstallEvent> l){events=l;}
    }
}
