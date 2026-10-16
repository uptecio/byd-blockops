package au.local.blockops.updates;

import java.util.Objects;
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
    private SavedState saved = new SavedState(0,0,0,null);
    private Release offer;
    private Candidate candidate;
    private UpdateCancellation token = new UpdateCancellation();
    private boolean home, foreground, launchEligible, closed, initialized, busy, dismissed, consent, confirmation;
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
                Candidate complete=null;
                try { complete=candidates.load(); if(complete!=null)verifier.inspect(complete,installed); }
                catch(Failure invalid) { complete=null;candidates.forget(); }
                Candidate recovered=complete;
                ui.execute(() -> initialize(loaded,pending,recovered));
            } catch(Failure failure) { ui.execute(() -> { synchronized(this){initialized=true;fail(failure);} }); }
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
        if(pendingCheck!=null){boolean manual=pendingCheck;pendingCheck=null;check(manual);}
    }
    public synchronized void home(boolean value) {
        if(closed)return;boolean entering=!home&&value;home=value;
        if(!value)depart();else if(entering&&initialized&&candidate==null&&!busy&&session==null)restoreCandidate();
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
        if(closed)return; boolean returning=!foreground&&value;foreground=value;launchEligible=value;
        if(!value)depart(); else if(returning&&initialized&&"permission".equals(state.phase))refreshPermission();
    }
    public synchronized Snapshot snapshot(){return state;}
    /** Activity pause/replacement revokes install consent without cancelling a foreground transfer. */
    public synchronized void activityDetached(){
        consent=false;launchEligible=false;
        if(busy&&session==null&&candidate!=null&&("verifying".equals(state.phase)||"installing".equals(state.phase))){
            invalidate();busy=false;showOffer("Return Home and tap Install again.");
        }
    }
    public synchronized boolean canConfirmInstall(){return eligible()&&launchEligible&&!busy&&session!=null&&confirmation;}
    public synchronized void check(boolean manual) {
        if(!initialized&&!closed){pendingCheck=Boolean.TRUE.equals(pendingCheck)||manual;return;}
        if(!eligible()||busy||session!=null)return;
        if(manual)dismissed=false;
        if(!mayRequest(manual)){showOffer("Please wait before checking again.");return;}
        long op=begin("checking","Checking for updates…"); UpdateCancellation cancellation=token; markRequest();
        worker.execute(() -> {
            try { cancellation.check();Release release=source.latest(cancellation);
                ui.execute(() -> { synchronized(this){if(!owns(op))return;checked(release);busy=false;showOffer("");} });
            } catch(Failure failure){completeFailure(op,failure,true);}
        });
    }
    public synchronized void download() {
        if(!eligible()||busy||session!=null||offer==null||candidate!=null||!newer(offer))return;
        if(!mayRequest(true)){publish("available",0,"Please wait before downloading.");return;}
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
        if(!eligible()||!launchEligible||busy)return;
        if(session!=null){if(confirmation){consent=true;confirm(session);}return;}
        if(candidate==null)return;
        Candidate selected=candidate;consent=true;long op=begin("verifying","Verifying update before installation…");
        worker.execute(() -> {
            try {
                try{verifier.inspect(selected,installed);}catch(Failure invalid){candidates.forget();throw invalid;}
                boolean allowed=installer.allowed();
                ui.execute(() -> {synchronized(this){
                    if(!owns(op))return;
                    if(!allowed){busy=false;consent=false;publish("permission",0,"Allow this app to install updates in Android Settings, then return and tap Install again.");return;}
                    publish("installing",0,"Preparing Android installation…");
                    worker.execute(() -> submit(op,selected));
                }});
            }catch(Failure failure){ui.execute(() -> {synchronized(this){if(owns(op)){candidate=null;busy=false;consent=false;fail(failure);}}});}
        });
    }
    private void submit(long op,Candidate selected) {
        final long priorEvents;
        synchronized(this){if(!owns(op)||!consent)return;priorEvents=installEvents;}
        try {int id=installer.commit(selected);ui.execute(() -> {synchronized(this){
            if(closed||installEvents!=priorEvents)return;session=id;busy=false;
            if(!owns(op))consent=false;
            publish("installing",0,"Waiting for Android installation…");
        }});}catch(Failure failure){
            boolean invalid="invalid_candidate".equals(failure.code)||"invalid_identity".equals(failure.code);
            if(invalid){try{candidates.forget();}catch(Failure ignored){/* Candidate remains unusable in this coordinator. */}}
            try{InstallEvent pending=installer.reconcile(null);ui.execute(() -> {synchronized(this){
                if(closed||installEvents!=priorEvents)return;
                if(!"installing".equals(pending.phase)&&!owns(op))return;
                busy=false;consent=false;
                if(invalid)candidate=null;
                if("installing".equals(pending.phase)){session=pending.sessionId;publish("installing",0,pending.message);}else fail(failure);
            }});}catch(Failure recovery){completeFailure(op,recovery,false);}
        }
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
        if(closed||(busy&&session!=null))return;invalidate();consent=false;confirmation=false;
        if(session!=null){int id=session;long priorEvents=installEvents;busy=true;publish("installing",0,"Cancelling pending installation…");
            worker.execute(() -> {try{installer.cancelOwned(id);ui.execute(() -> {synchronized(this){if(closed||installEvents!=priorEvents)return;session=null;busy=false;showOffer("Installation cancelled.");}});}
                catch(Failure failure){ui.execute(() -> {synchronized(this){if(closed||installEvents!=priorEvents)return;busy=false;fail(failure);}});}});
        }else{busy=false;publish(candidate!=null?"ready":"idle",0,"Update cancelled. You can retry.");cleanupPartial();}
    }
    public synchronized void dismiss(){if(closed)return;dismissed=true;consent=false;publish(state.phase,state.downloadedBytes,state.message);}
    private void depart(){consent=false;if(busy&&session==null){invalidate();busy=false;publish(candidate!=null?"ready":"error",0,"Update interrupted. Return Home to retry.");cleanupPartial();}}
    private synchronized void event(InstallEvent event){
        if(closed)return;
        if(session!=null&&session!=event.sessionId)return;
        ++installEvents;
        if("confirmation".equals(event.phase)){
            session=event.sessionId;confirmation=true;busy=false;publish("installing",0,event.message);
            if(consent&&eligible())confirm(event.sessionId);
        }else if("installing".equals(event.phase)){session=event.sessionId;busy=false;publish("installing",0,event.message);}
        else{session=null;confirmation=false;consent=false;busy=false;
            if("error".equals(event.phase))publish("error",0,event.message);else publish("idle",0,"Review update status after reopening the app. Completed downloads remain available for an explicit retry.");
        }
    }
    private void confirm(int id){try{installer.confirm(id);confirmation=false;consent=false;publish("installing",0,"Waiting for Android installation…");}catch(Failure failure){consent=false;fail(failure);}}
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
    private void fail(Failure failure){publish("error",0,failure.message);}
    private void showOffer(String message){publish(candidate!=null?"ready":offer==null?"idle":newer(offer)?"available":"current",0,message);}
    private boolean newer(Release release){try{return UpdatePolicy.compare(release.version,UpdatePolicy.parseVersion(installed.versionName,false))>0;}catch(IllegalArgumentException invalid){return false;}}
    private void publish(String phase,long bytes,String message){
        state=new Snapshot(state.revision+1,phase,installed.versionName,offer==null?null:offer.version.toString(),offer==null?0:offer.asset.size,bytes,message,dismissed);
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
