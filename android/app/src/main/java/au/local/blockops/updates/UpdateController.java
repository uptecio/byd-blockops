package au.local.blockops.updates;

import java.util.Objects;
import java.util.ArrayDeque;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import static au.local.blockops.updates.UpdateModel.*;
import static au.local.blockops.updates.UpdatePorts.*;

/** Application state; workers do IO, UI completions must still own their operation generation. */
public final class UpdateController implements AutoCloseable {
    private static final long CACHE = 21600000, BACKOFF = 900000, FLOOR = 30000;
    // Bound corrupt/recovered deadlines once, never extend them on each check.
    private static final long MAX_RETRY = 604800000;
    private final InstalledApp installed;
    private final ReleaseSource source;
    private final CandidateStore candidates;
    private final Verifier verifier;
    private final Installer installer;
    private final StateStore store;
    private final Clock clock;
    private final Executor worker, ui, cleanup;
    private ExecutorService ownedCleanup;
    private final Listener listener;
    private volatile Snapshot state;
    private long generation, installEvents, requestAt = -1, successUntil, failureUntil, retryUntil, lastWall;
    private Boolean pendingCheck;
    private final ArrayDeque<InstallEvent> startupEvents = new ArrayDeque<>();
    private SavedState saved = new SavedState(0,0,0,null);
    private Release offer;
    private Candidate candidate;
    private UpdateCancellation token = new UpdateCancellation();
    private boolean home, foreground, launchEligible, closed, initialized, busy, dismissed, consent, confirmation;
    private boolean submitting, cancelSubmission, cancelling, recoveryNeeded;
    private Integer session;

    public UpdateController(InstalledApp installed, ReleaseSource source, CandidateStore candidates,
            Verifier verifier, Installer installer, StateStore store, Clock clock,
            Executor worker, Executor ui, Listener listener) {
        this(installed,source,candidates,verifier,installer,store,clock,worker,ui,listener,
            Executors.newSingleThreadExecutor(r -> {Thread thread=new Thread(r,"updater-cleanup");thread.setDaemon(true);return thread;}));
        ownedCleanup=(ExecutorService)cleanup;
    }
    /** Integration overload keeps resource teardown separate from the serial transfer worker. */
    public UpdateController(InstalledApp installed, ReleaseSource source, CandidateStore candidates,
            Verifier verifier, Installer installer, StateStore store, Clock clock,
            Executor worker, Executor ui, Listener listener, Executor cleanup) {
        this.installed=installed; this.source=source; this.candidates=candidates; this.verifier=verifier;
        this.installer=installer; this.store=store; this.clock=clock; this.worker=worker; this.ui=ui; this.listener=listener;this.cleanup=cleanup;
        state=new Snapshot(0,"idle",installed.versionName,null,0,0,"",false);
        worker.execute(() -> {
            try {
                installer.setListener(event -> ui.execute(() -> event(event)));
                SavedState loaded=store.load(); InstallEvent pending=installer.reconcile(null);
                candidates.deletePartial();
                Candidate complete=null;
                try { complete=candidates.load(); if(complete!=null)verifier.inspect(complete,installed); }
                catch(Failure invalid) { complete=null;candidates.forget(); }
                Candidate recovered=complete;
                ui.execute(() -> initialize(loaded,pending,recovered));
            } catch(Failure failure) { ui.execute(() -> { synchronized(this){if(closed)return;initialized=true;fail(failure);replayStartupEvents();} }); }
        });
    }
    private synchronized void initialize(SavedState loaded, InstallEvent pending, Candidate complete) {
        if(closed)return;
        long now=wall(), elapsed=clock.elapsedMillis();
        long success=loaded.cachedRelease==null?0:validPast(loaded.lastSuccessWallMillis,now), failure=validPast(loaded.lastFailureWallMillis,now);
        long retry=boundedRetry(loaded.serverRetryUntilWallMillis,now);
        saved=new SavedState(success,failure,retry,loaded.cachedRelease); lastWall=now;
        successUntil=deadline(elapsed,remaining(success,CACHE,now));
        failureUntil=deadline(elapsed,remaining(failure,BACKOFF,now));
        retryUntil=deadline(elapsed,retry>now?retry-now:0);
        offer=loaded.cachedRelease; candidate=complete; initialized=true;
        if(complete!=null)offer=complete.release;
        persist();
        if("installing".equals(pending.phase)){session=pending.sessionId;publish("installing",0,pending.message);}
        else showOffer("");
        replayStartupEvents();
        if(pendingCheck!=null){boolean manual=pendingCheck;pendingCheck=null;check(manual);}
        automaticCheck();
    }
    private void replayStartupEvents(){while(!startupEvents.isEmpty())event(startupEvents.remove());}
    public synchronized void home(boolean value) {
        if(closed)return;
        boolean entering=!home&&value;
        home=value;
        if(!value){
            depart();
        }else if(entering){
            if(initialized&&candidate==null&&!busy&&session==null)restoreCandidate();
            automaticCheck();
        }
    }
    private void restoreCandidate(){
        long op=generation;
        worker.execute(() -> {
            try{
                Candidate complete=candidates.load();if(complete==null)return;verifier.inspect(complete,installed);
                ui.execute(() -> {synchronized(this){if(owns(op)&&!busy&&candidate==null){candidate=complete;offer=complete.release;showOffer("Downloaded update is ready for review.");}}});
            }catch(Failure invalid){try{candidates.forget();}catch(Failure ignored){/* Never expose invalid candidate. */}}
        });
    }
    public synchronized void foreground(boolean value) {
        if(closed)return;
        boolean returning=!foreground&&value;
        foreground=value;
        launchEligible=value;
        if(!value){
            depart();
        }else if(returning){
            if(initialized&&"permission".equals(state.phase))refreshPermission();
            automaticCheck();
        }
    }
    private void automaticCheck(){
        if(eligible()&&candidate==null)check(false);
    }
    public synchronized Snapshot snapshot(){return state;}
    /** Native-only release text; never expands the WebView snapshot or command surface. */
    public synchronized String releaseSummary(){return offer==null?"":plainText(offer.summary,512);}
    /** Activity pause/replacement revokes install consent without cancelling a foreground transfer. */
    public synchronized void activityDetached(){
        consent=false;launchEligible=false;
        if(submitting){requestSubmissionCancellation();return;}
        if(busy&&session==null&&candidate!=null&&("verifying".equals(state.phase)||"installing".equals(state.phase))){
            invalidate();busy=false;showOffer("Return Home and tap Install again.");
        }
    }
    public synchronized boolean canConfirmInstall(){return eligible()&&launchEligible&&!busy&&!recoveryNeeded&&session!=null&&confirmation;}
    public synchronized void check(boolean manual) {
        if(!initialized&&!closed){pendingCheck=Boolean.TRUE.equals(pendingCheck)||manual;return;}
        if(!eligible()||busy||session!=null||recoveryNeeded)return;
        if(manual)dismissed=false;
        if(!mayRequest(manual)){
            if(manual)showOffer("Please wait before checking again.");
            return;
        }
        long op=begin("checking","Checking for updates…"); UpdateCancellation cancellation=token; markRequest();
        worker.execute(() -> {
            try { cancellation.check();Release release=source.latest(cancellation);
                ui.execute(() -> { synchronized(this){if(!owns(op))return;checked(release);busy=false;showOffer("");} });
            } catch(Failure failure){completeFailure(op,failure,true);}
        });
    }
    public synchronized void download() {
        if(!eligible()||busy||session!=null||recoveryNeeded||offer==null||candidate!=null||!newer(offer))return;
        // This consented recheck is distinct from manual Check. Server/failure guards still apply.
        if(clock.elapsedMillis()<Math.max(retryUntil,failureUntil)){publish("available",0,"Please wait before downloading.");return;}
        Release selected=offer;long op=begin("checking","Checking the selected update…"); UpdateCancellation cancellation=token;markRequest();
        worker.execute(() -> {
            try { cancellation.check();Release fresh=source.latest(cancellation);
                ui.execute(() -> { synchronized(this){
                    if(!owns(op))return;checked(fresh);
                    if(!same(selected,fresh)){busy=false;candidate=null;showOffer("The update changed. Review it and tap Download again.");return;}
                    publish("downloading",0,"Downloading update…");
                    worker.execute(() -> transfer(op,fresh,cancellation));
                }});
            } catch(Failure failure){completeFailure(op,failure,true);}
        });
    }
    private void transfer(long op,Release release,UpdateCancellation cancellation) {
        try {
            cancellation.check();Candidate complete=candidates.download(release,cancellation,(n,total) -> ui.execute(() -> {
                synchronized(this){if(owns(op))publish("downloading",Math.min(Math.max(0,n),release.asset.size),"Downloading update…");}
            }));
            cancellation.check();ui.execute(() -> {synchronized(this){if(owns(op))publish("verifying",release.asset.size,"Verifying update…");}});
            try { verifier.inspect(complete,installed); }catch(Failure invalid){candidates.forget();throw invalid;}
            cancellation.check();ui.execute(() -> {synchronized(this){if(!owns(op))return;candidate=complete;busy=false;showOffer("Ready to install.");}});
        }catch(Failure failure){completeFailure(op,failure,false);}
    }
    public synchronized void install() {
        if(!eligible()||!launchEligible||busy||recoveryNeeded)return;
        if(session!=null){if(confirmation){consent=true;confirm(session);}return;}
        if(candidate==null)return;
        Candidate selected=candidate;consent=true;long op=begin("verifying","Verifying update before installation…");
        UpdateCancellation cancellation=token;
        worker.execute(() -> {
            try {
                try{verifier.inspect(selected,installed);}catch(Failure invalid){candidates.forget();throw invalid;}
                boolean allowed=installer.allowed();
                ui.execute(() -> {synchronized(this){
                    if(!owns(op))return;
                    if(!allowed){busy=false;consent=false;publish("permission",0,"Allow this app to install updates in Android Settings, then return and tap Install again.");return;}
                    publish("installing",0,"Preparing Android installation…");
                    worker.execute(() -> submit(op,selected,cancellation));
                }});
            }catch(Failure failure){ui.execute(() -> {synchronized(this){if(owns(op)){candidate=null;busy=false;consent=false;fail(failure);}}});}
        });
    }
    private void submit(long op,Candidate selected,UpdateCancellation cancellation) {
        final long priorEvents;
        synchronized(this){
            if(!owns(op)||!consent)return;
            priorEvents=installEvents;
            submitting=true;
        }
        try {
            int id=installer.commit(selected,cancellation);
            ui.execute(() -> submissionResult(op,priorEvents,new InstallEvent(id,"installing","Waiting for Android installation…"),null,false));
        }catch(Failure failure){
            boolean invalid="invalid_candidate".equals(failure.code)||"invalid_identity".equals(failure.code);
            if(invalid){try{candidates.forget();}catch(Failure ignored){/* Never expose the invalid candidate. */}}
            final InstallEvent pending;
            try{pending=installer.reconcile(null);}
            catch(Failure recovery){ui.execute(() -> submissionResult(op,priorEvents,null,recovery,invalid));return;}
            ui.execute(() -> submissionResult(op,priorEvents,pending,failure,invalid));
        }
    }
    private synchronized void submissionResult(long op,long priorEvents,InstallEvent pending,Failure failure,boolean invalid){
        if(invalid)candidate=null;
        // Keep this operation busy through its return and cancellation resolution. A native Cancel
        // after the final platform gate is still a request to cancel the resulting owned session.
        if(cancelSubmission||closed){cancelOwnedSession(null);return;}
        submitting=false;busy=false;
        if(installEvents!=priorEvents){
            if(confirmation&&session!=null&&consent&&owns(op)&&launchEligible)confirm(session);
            return;
        }
        if(pending==null){recoveryNeeded=true;consent=false;publish("installing",0,failure.message);return;}
        if("installing".equals(pending.phase)){
            session=pending.sessionId;publish("installing",0,pending.message);
        }else if(owns(op)){
            consent=false;session=null;if(failure!=null)fail(failure);else showOffer("");
        }
    }
    private void requestSubmissionCancellation(){
        if(cancelSubmission)return;
        invalidate();cancelSubmission=true;consent=false;confirmation=false;busy=true;
        publish("installing",0,"Cancelling pending installation…");
    }
    private void cancelOwnedSession(Integer expected){
        if(cancelling)return;
        cancelling=true;busy=true;long priorEvents=installEvents;
        worker.execute(() -> {
            Integer known=expected;Failure failure=null;
            try{
                InstallEvent pending=installer.reconcile(null);
                if(!"idle".equals(pending.phase)){
                    known=pending.sessionId;
                    if(expected!=null&&!expected.equals(known))throw new Failure("wrong_session","The pending installation changed. Review it before cancelling.");
                    installer.cancelOwned(known);
                }
            }catch(Failure problem){failure=problem;}
            Integer retained=known;Failure problem=failure;
            ui.execute(() -> {synchronized(this){
                submitting=false;cancelSubmission=false;cancelling=false;busy=false;recoveryNeeded=false;
                if(closed)return;
                if(installEvents!=priorEvents&&session==null)return;
                if(problem!=null){session=retained;recoveryNeeded=retained==null;publish("installing",0,problem.message);}
                else{session=null;confirmation=false;showOffer("Installation cancelled.");}
            }});
        });
    }
    public synchronized void openPermissionSettings() {
        if(!eligible()||!launchEligible||busy||!"permission".equals(state.phase))return;
        consent=false;
        try{installer.openPermissionSettings();}catch(Failure failure){fail(failure);}
    }
    private void refreshPermission(){
        long op=generation;
        worker.execute(() -> {try{boolean allowed=installer.allowed();ui.execute(() -> {synchronized(this){
            if(!closed&&op==generation&&candidate!=null&&"permission".equals(state.phase)&&allowed)showOffer("Permission granted. Tap Install to continue.");
        }});}catch(Failure failure){completeFailure(op,failure,false);}});
    }
    public synchronized void cancel(){
        if(closed||cancelling)return;
        if(submitting){requestSubmissionCancellation();return;}
        invalidate();consent=false;confirmation=false;
        if(session!=null||recoveryNeeded){publish("installing",0,"Cancelling pending installation…");cancelOwnedSession(session);
        }else{busy=false;publish(candidate!=null?"ready":"idle",0,"Update cancelled. You can retry.");cleanupPartial();}
    }
    public synchronized void dismiss(){
        if(closed)return;
        dismissed=true;
        consent=false;
        if(submitting){
            requestSubmissionCancellation();
        }else if(busy&&session==null&&candidate!=null&&!cancelling
                &&("verifying".equals(state.phase)||"installing".equals(state.phase))){
            invalidate();
            busy=false;
            showOffer("Tap Install when you are ready to continue.");
        }else{
            publish(state.phase,state.downloadedBytes,state.message);
        }
    }
    private void depart(){
        consent=false;
        if(submitting){
            requestSubmissionCancellation();
            return;
        }
        if(busy&&session==null&&!cancelling){
            invalidate();
            busy=false;
            publish(candidate!=null?"ready":"error",0,"Update interrupted. Return Home to retry.");
            cleanupPartial();
        }
    }
    private synchronized void event(InstallEvent event){
        if(closed)return;
        if(!initialized){startupEvents.add(event);return;}
        if(session!=null&&session!=event.sessionId)return;
        ++installEvents;
        boolean operationPending=submitting||cancelling;
        if("confirmation".equals(event.phase)){
            session=event.sessionId;confirmation=!cancelSubmission&&!cancelling;busy=operationPending;publish("installing",0,cancelSubmission?"Cancelling pending installation…":event.message);
            if(!operationPending&&consent&&eligible()&&launchEligible)confirm(event.sessionId);
        }else if("installing".equals(event.phase)){session=event.sessionId;busy=operationPending;publish("installing",0,cancelSubmission?"Cancelling pending installation…":event.message);}
        else{session=null;confirmation=false;consent=false;busy=operationPending;recoveryNeeded=false;
            if("error".equals(event.phase))publish("error",0,event.message);else publish("idle",0,"Review update status after reopening the app. Completed downloads remain available for an explicit retry.");
        }
    }
    private void confirm(int id){try{installer.confirm(id);confirmation=false;consent=false;publish("installing",0,"Waiting for Android installation…");}catch(Failure failure){confirmation=false;consent=false;fail(failure);}}
    private void cleanupPartial(){worker.execute(() -> {try{candidates.deletePartial();}catch(Failure ignored){/* A later operation retries owned cleanup. */}});}
    private long begin(String phase,String message){invalidate();busy=true;publish(phase,0,message);return generation;}
    private void invalidate(){++generation;UpdateCancellation old=token;token=new UpdateCancellation();old.cancel(cleanup);}
    private boolean owns(long op){return !closed&&op==generation&&home&&foreground;}
    private boolean eligible(){return initialized&&!closed&&home&&foreground;}
    private boolean mayRequest(boolean manual){
        long now=wall(),elapsed=clock.elapsedMillis();
        if(now<lastWall){
            if(saved.lastSuccessWallMillis>now)successUntil=0;
            // In-process failure/backoff and server guards remain anchored to elapsed time.
            saved=new SavedState(validPast(saved.lastSuccessWallMillis,now),validPast(saved.lastFailureWallMillis,now),saved.serverRetryUntilWallMillis,saved.cachedRelease);persist();
        }
        lastWall=now;
        return (requestAt<0||elapsed-requestAt>=FLOOR)&&elapsed>=retryUntil&&(manual||elapsed>=Math.max(successUntil,failureUntil));
    }
    private void markRequest(){requestAt=clock.elapsedMillis();}
    private void checked(Release release){
        if(offer==null||offer.id!=release.id||!offer.tag.equals(release.tag))dismissed=false;
        if(candidate!=null&&!same(candidate.release,release))candidate=null;
        offer=release;long now=wall();successUntil=deadline(clock.elapsedMillis(),CACHE);failureUntil=0;
        saved=new SavedState(now,0,saved.serverRetryUntilWallMillis,release);persist();}
    private void completeFailure(long op,Failure failure,boolean request){ui.execute(() -> {synchronized(this){if(!owns(op))return;busy=false;
        if(request||failure.serverRetryUntilWallMillis!=null){long now=wall();long retry=boundedRetry(failure.serverRetryUntilWallMillis==null?0:failure.serverRetryUntilWallMillis,now);
            retry=Math.max(saved.serverRetryUntilWallMillis,retry);retryUntil=Math.max(retryUntil,deadline(clock.elapsedMillis(),retry>now?retry-now:0));
            failureUntil=deadline(clock.elapsedMillis(),BACKOFF);saved=new SavedState(saved.lastSuccessWallMillis,now,retry,saved.cachedRelease);persist();}
        fail(failure);
    }});}
    private void persist(){SavedState copy=saved;worker.execute(() -> {try{store.save(copy);}catch(Failure failure){ui.execute(() -> {synchronized(this){if(!closed)fail(failure);}});}});}
    private void fail(Failure failure){publish(session==null&&!recoveryNeeded?"error":"installing",0,failure.message);}
    private void showOffer(String message){
        String phase=candidate!=null?"ready":offer==null?"idle":newer(offer)?"available":"current";
        if(message.isEmpty()){
            if("current".equals(phase))message="You are up to date.";
            else if("available".equals(phase))message="Update available.";
            else if("ready".equals(phase))message="Ready to install.";
        }
        publish(phase,0,message);
    }
    private boolean newer(Release release){try{return UpdatePolicy.compare(release.version,UpdatePolicy.parseVersion(installed.versionName,false))>0;}catch(IllegalArgumentException invalid){return false;}}
    private void publish(String phase,long bytes,String message){
        state=new Snapshot(state.revision+1,phase,installed.versionName,offer==null||!newer(offer)?null:offer.version.toString(),offer==null?0:offer.asset.size,bytes,message,dismissed);
        Snapshot next=state;ui.execute(() -> {synchronized(this){if(!closed&&state==next)listener.onState(next);}});
    }
    private static boolean same(Release a,Release b){return a.id==b.id&&a.tag.equals(b.tag)&&a.asset.id==b.asset.id&&a.asset.size==b.asset.size&&a.asset.uri.equals(b.asset.uri)&&Objects.equals(a.asset.digest,b.asset.digest)&&a.sha256.equals(b.sha256);}
    private long wall(){return Math.max(0,clock.wallMillis());}
    private static long validPast(long value,long now){return value>0&&value<=now?value:0;}
    private static long remaining(long from,long duration,long now){return from==0?0:Math.max(0,duration-(now-from));}
    private static long boundedRetry(long retry,long now){if(retry<=now||retry==Long.MAX_VALUE)return 0;return deadline(now,Math.min(MAX_RETRY,retry-now));}
    private static long deadline(long from,long delay){return delay>Long.MAX_VALUE-from?Long.MAX_VALUE:from+delay;}
    @Override public synchronized void close(){if(closed)return;closed=true;consent=false;invalidate();cleanupPartial();worker.execute(() -> {try{installer.setListener(e -> {});}catch(Failure ignored){}});if(ownedCleanup!=null)ownedCleanup.shutdown();}
}
