package au.local.blockops.updates;

import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.security.Principal;
import java.security.cert.Certificate;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import javax.net.ssl.*;
import static au.local.blockops.updates.UpdateModel.*;

/** Real transport/store behavior with only the external HTTPS socket replaced. */
public final class UpdaterTransferTest {
    private static final URI URI_APK = URI.create("https://github.com/uptecio/byd-blockops/releases/download/v0.12.0/block-ops-test.apk");
    private static final String ABC_SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    private static final byte[] ABC = new byte[]{97, 98, 99};
    private static final class Clock implements UpdatePorts.Clock {
        long elapsed, wall = 1_800_000_000_000L;
        public long wallMillis() { return wall; }
        public long elapsedMillis() { return elapsed; }
    }
    public static void main(String[] args) throws Exception {
        trustedParentAliasRetainsCandidate();
        redirectLimits(); boundedRead(); cancelClosesConnection(); truncatedAndOversizedDownload();
        deadlinesAndTls(); retryDeadlines(); privatePromotion(); metadataAndDiskFailure(); staleTransferCannotReplaceFile();
        cleanupCannotDeleteNewTransfer();
        delayedForgetPreservesNewCandidate();
        supersededTransfersRemainCancellable();
        supersedingDuringDelayedTeardown();
        System.out.println("PASS transfer");
    }
    // Android aliases Context.getFilesDir's /data/user/0 parent to /data/data.
    // A trusted root alias must reload; candidate symlinks still fail even with matching bytes.
    private static void trustedParentAliasRetainsCandidate() throws Exception {
        Path root=Files.createTempDirectory("updater-parent-alias-");
        try {
            Path real=Files.createDirectory(root.resolve("real")),alias=root.resolve("alias");
            Files.createSymbolicLink(alias,real);
            UpdateCandidateStore store=new UpdateCandidateStore(alias.resolve("updater").toFile(),transport(connection(200,ABC)));
            Candidate downloaded=store.download(release(1,ABC_SHA),new UpdateCancellation(),(n,t)->{});
            Candidate loaded=store.load();
            assert loaded!=null&&loaded.release.id==1&&Arrays.equals(ABC,Files.readAllBytes(loaded.file.toPath())) : "Trusted parent alias lost complete candidate";
            Path outside=root.resolve("unrelated.apk");Files.write(outside,ABC);
            Files.delete(downloaded.file.toPath());Files.createSymbolicLink(downloaded.file.toPath(),outside);
            fails(store::load);assert Arrays.equals(ABC,Files.readAllBytes(outside));
            Files.delete(downloaded.file.toPath());
            Path inside=real.resolve("updater/unrelated.apk");Files.write(inside,ABC);Files.createSymbolicLink(downloaded.file.toPath(),inside);
            fails(store::load);assert Arrays.equals(ABC,Files.readAllBytes(inside));
        } finally {remove(root);}
    }
    // A sixth follow, implicit follow, unsafe hop, auth header, or leaked query must fail here.
    private static void redirectLimits() throws Exception {
        List<Connection> used = new ArrayList<>();
        HttpsUpdateTransport transport = new HttpsUpdateTransport(url -> {
            Connection c = new Connection(url, 302, new byte[0]);
            c.headers.put("Location", "https://release-assets.githubusercontent.com/asset?secret=hidden");
            used.add(c); return c;
        }, new Clock());
        UpdatePorts.Failure failure = fails(() -> transport.read(URI_APK, 512 * 1024, new UpdateCancellation()));
        assert used.size() == 6 : "More than five redirects followed";
        assert !failure.message.contains("secret") && failure.getCause() == null;
        for (Connection c : used) {
            assert !c.getInstanceFollowRedirects();
            assert c.getRequestProperty("Authorization") == null;
            assert c.disconnected;
        }
        Connection unsafe = connection(302, ABC);
        unsafe.headers.put("Location", "http://github.com/unsafe");
        AtomicInteger opens = new AtomicInteger();
        fails(() -> new HttpsUpdateTransport(url -> { opens.incrementAndGet(); return unsafe; }, new Clock())
                .read(URI_APK, 100, new UpdateCancellation()));
        assert opens.get() == 1;
        List<Connection> chain = new ArrayList<>();
        HttpsUpdateTransport five = new HttpsUpdateTransport(url -> {
            Connection c = new Connection(url, chain.size() < 5 ? 302 : 200, ABC);
            c.headers.put("Location", "https://objects.githubusercontent.com/asset?signature=hidden");
            chain.add(c); return c;
        }, new Clock());
        assert Arrays.equals(ABC, five.read(URI_APK, 3, new UpdateCancellation()).bytes);
        assert chain.size() == 6;
    }
    // Missing streaming byte bound must never consume more than limit+1.
    private static void boundedRead() throws Exception {
        Connection c = connection(200, new byte[600_000]);
        fails(() -> transport(c).read(URI_APK, 512 * 1024, new UpdateCancellation()));
        assert c.bytesRead <= 512 * 1024 + 1 : c.bytesRead;
        assert c.closed && c.disconnected;
        Connection exact = connection(200, ABC);
        assert Arrays.equals(ABC, transport(exact).read(URI_APK, 3, new UpdateCancellation()).bytes);
        Connection error = connection(429, new byte[600_000]);
        error.headers.put("Retry-After", "60");
        HttpsUpdateTransport.Response response = transport(error).read(URI_APK, 3, new UpdateCancellation());
        assert response.status == 429 && response.bytes.length == 0 && error.bytesRead == 0;
        assert response.serverRetryUntilWallMillis == 1_800_000_060_000L;
    }
    // A cancellation inside read must close both resources and suppress the next progress callback.
    private static void cancelClosesConnection() throws Exception {
        UpdateCancellation token = new UpdateCancellation();
        Connection c = connection(200, ABC);
        c.afterRead = token::cancel;
        AtomicInteger progress = new AtomicInteger();
        UpdatePorts.Failure failure = fails(() -> transport(c).copy(URI_APK, new ByteArrayOutputStream(), 3,
                token, (n, total) -> progress.incrementAndGet()));
        assert failure.code.equals("cancelled");
        assert c.closed && c.disconnected && progress.get() == 0;
        UpdateCancellation early = new UpdateCancellation(); early.cancel();
        AtomicInteger opens = new AtomicInteger();
        fails(() -> new HttpsUpdateTransport(url -> { opens.incrementAndGet(); return c; }, new Clock())
                .read(URI_APK, 3, early));
        assert opens.get() == 0;
        // Cancellation also interrupts a read blocked on an external socket.
        UpdateCancellation blockingToken = new UpdateCancellation();
        Connection blocking = connection(200, ABC);
        CountDownLatch entered = new CountDownLatch(1), released = new CountDownLatch(1);
        blocking.beforeRead = () -> { entered.countDown(); await(released); };
        blocking.onDisconnect = released::countDown;
        AtomicReference<Throwable> result = new AtomicReference<>();
        Thread thread = new Thread(() -> { try { transport(blocking).read(URI_APK, 3, blockingToken); }
            catch (Throwable e) { result.set(e); } });
        thread.start(); assert entered.await(5, TimeUnit.SECONDS); blockingToken.cancel(); thread.join(5000);
        assert !thread.isAlive() && result.get() instanceof UpdatePorts.Failure;
        assert ((UpdatePorts.Failure) result.get()).code.equals("cancelled");
    }
    private static void truncatedAndOversizedDownload() throws Exception {
        fails(() -> transport(connection(200, new byte[2])).copy(URI_APK, new ByteArrayOutputStream(), 3,
                new UpdateCancellation(), (n, total) -> {}));
        Connection big = connection(200, new byte[9]);
        fails(() -> transport(big).copy(URI_APK, new ByteArrayOutputStream(), 3,
                new UpdateCancellation(), (n, total) -> {}));
        assert big.bytesRead <= 4;
        assert transport(connection(200, ABC)).copy(URI_APK, new ByteArrayOutputStream(), 3,
                new UpdateCancellation(), (n, total) -> {}).equals(ABC_SHA);
        AtomicInteger opens = new AtomicInteger();
        fails(() -> new HttpsUpdateTransport(url -> { opens.incrementAndGet(); return big; }, new Clock())
                .copy(URI_APK, new ByteArrayOutputStream(), 100L * 1024 * 1024 + 1,
                        new UpdateCancellation(), (n, total) -> {}));
        assert opens.get() == 0;
    }
    private static void deadlinesAndTls() throws Exception {
        Clock clock = new Clock(); Connection c = connection(200, ABC);
        c.afterRead = () -> clock.elapsed = 300_001;
        fails(() -> new HttpsUpdateTransport(url -> c, clock).read(URI_APK, 3, new UpdateCancellation()));
        assert c.closed && c.disconnected;
        assert c.getConnectTimeout() > 0 && c.getConnectTimeout() <= 10_000;
        assert c.getReadTimeout() > 0 && c.getReadTimeout() <= 30_000;
        HttpsUpdateTransport tls = new HttpsUpdateTransport(url -> { throw new SSLHandshakeException("secret query"); }, clock);
        UpdatePorts.Failure failure = fails(() -> tls.read(URI_APK, 3, new UpdateCancellation()));
        assert !failure.message.contains("secret") && failure.getCause() == null;
        Connection platformFailure = connection(200, ABC);
        platformFailure.responseFailure = new IllegalStateException("https://objects.githubusercontent.com/asset?secret=query");
        UpdatePorts.Failure safe = fails(() -> transport(platformFailure).read(URI_APK, 3, new UpdateCancellation()));
        assert !safe.message.contains("secret") && safe.getCause() == null;
        Clock redirectsClock = new Clock(); AtomicInteger opens = new AtomicInteger();
        fails(() -> new HttpsUpdateTransport(url -> {
            opens.incrementAndGet(); redirectsClock.elapsed += 100_000;
            Connection redirect = new Connection(url, 302, ABC);
            redirect.headers.put("Location", "https://github.com/asset"); return redirect;
        }, redirectsClock).read(URI_APK, 3, new UpdateCancellation()));
        assert opens.get() == 3 : "Deadline was reset at redirect";
        Connection dishonest = connection(200, ABC); dishonest.headers.put("Content-Length", "2");
        fails(() -> transport(dishonest).read(URI_APK, 3, new UpdateCancellation()));
        Connection compressed = connection(200, ABC); compressed.headers.put("Content-Encoding", "gzip");
        fails(() -> transport(compressed).read(URI_APK, 3, new UpdateCancellation()));
    }
    // Incomplete/foreign metadata must fail closed; a failed metadata write must leave only unrelated files.
    private static void metadataAndDiskFailure() throws Exception {
        Path directory = Files.createTempDirectory("updater-metadata-");
        try {
            AtomicInteger opens = new AtomicInteger();
            File fullDirectory = new File(directory.toString()) { @Override public long getUsableSpace() { return 0; } };
            UpdateCandidateStore full = new UpdateCandidateStore(fullDirectory, new HttpsUpdateTransport(url -> {
                opens.incrementAndGet(); return new Connection(url, 200, ABC);
            }, new Clock()));
            UpdatePorts.Failure fullFailure = fails(() -> full.download(release(1, ABC_SHA), new UpdateCancellation(), (n, t) -> {}));
            assert fullFailure.code.equals("storage_full") && opens.get() == 0 && full.load() == null;
            UpdateCandidateStore store = new UpdateCandidateStore(directory.toFile(), transport(connection(200, ABC)));
            Candidate candidate = store.download(release(1, ABC_SHA), new UpdateCancellation(), (n, t) -> {});
            Path metadata = directory.resolve("candidate.properties");
            Properties original = new Properties();
            try (InputStream in = Files.newInputStream(metadata)) { original.load(in); }
            for (String missing : new String[]{"schema", "file", "releaseId", "tag", "assetId", "name", "uri", "size", "digest", "sha256", "summary"}) {
                Properties bad = new Properties(); bad.putAll(original); bad.remove(missing);
                try (OutputStream out = Files.newOutputStream(metadata)) { bad.store(out, null); }
                fails(store::load);
            }
            for (String foreign : new String[]{"../save.apk", "block-ops-test.apk", "/tmp/candidate.apk"}) {
                Properties bad = new Properties(); bad.putAll(original); bad.setProperty("file", foreign);
                try (OutputStream out = Files.newOutputStream(metadata)) { bad.store(out, null); }
                fails(store::load);
            }
            Files.delete(metadata); fails(store::load); // Orphaned APK/metadata pair is inconsistent.
            store.forget();
            Files.createDirectory(metadata);
            Path unrelated = metadata.resolve("save.json"); Files.write(unrelated, ABC);
            fails(() -> store.download(release(2, ABC_SHA), new UpdateCancellation(), (n, t) -> {}));
            assert Arrays.equals(ABC, Files.readAllBytes(unrelated));
            try (java.util.stream.Stream<Path> paths = Files.list(directory)) {
                assert paths.count() == 1 : "Failed promotion left owned APK/partials behind";
            }
            assert !candidate.file.exists();
        } finally { remove(directory); }
    }
    private static void retryDeadlines() throws Exception {
        long now = 1_800_000_000_000L;
        assert HttpsUpdateTransport.retryDeadline("60", "1800000120", now) == now + 120_000;
        assert Long.valueOf(now + 120_000).equals(HttpsUpdateTransport.retryDeadline(" 60\t", " 1800000120 ", now));
        assert HttpsUpdateTransport.retryDeadline("Fri, 15 Jan 2027 08:01:00 GMT", null, now) == now + 60_000;
        assert HttpsUpdateTransport.retryDeadline("bad", "1800000001", now) == now + 1_000;
        assert HttpsUpdateTransport.retryDeadline("-1", "999999999999999999999999999", now) == null;
        assert HttpsUpdateTransport.retryDeadline("99999999999999999999", "0", now) == null;
        assert HttpsUpdateTransport.retryDeadline("0", "1799999999", now) == null;
        Connection c = connection(403, ABC); c.headers.put("Retry-After", "120");
        UpdatePorts.Failure failure = fails(() -> transport(c).copy(URI_APK, new ByteArrayOutputStream(), 3,
                new UpdateCancellation(), (n, t) -> {}));
        assert failure.serverRetryUntilWallMillis == now + 120_000;
    }
    // Integrity failures cannot replace a known candidate; load must rehash actual private bytes.
    private static void privatePromotion() throws Exception {
        Path directory = Files.createTempDirectory("updater-transfer-");
        try {
            Connection good = connection(200, ABC);
            UpdateCandidateStore store = new UpdateCandidateStore(directory.toFile(), transport(good));
            Candidate first = store.download(release(1, ABC_SHA), new UpdateCancellation(), (n, t) -> {});
            assert first.file.isFile() && Arrays.equals(ABC, Files.readAllBytes(first.file.toPath()));
            assert store.load().release.id == 1;
            Connection wrong = connection(200, new byte[]{0, 0, 0});
            UpdateCandidateStore badStore = new UpdateCandidateStore(directory.toFile(), transport(wrong));
            fails(() -> badStore.download(release(2, ABC_SHA), new UpdateCancellation(), (n, t) -> {}));
            assert store.load().release.id == 1 && first.file.exists();
            UpdateCancellation token = new UpdateCancellation();
            Connection cancelled = connection(200, ABC); cancelled.afterRead = token::cancel;
            fails(() -> new UpdateCandidateStore(directory.toFile(), transport(cancelled))
                    .download(release(3, ABC_SHA), token, (n, t) -> {}));
            assert store.load().release.id == 1;
            assertNoPartials(directory);
            Files.write(first.file.toPath(), new byte[]{0, 0, 0});
            fails(store::load);
            Files.write(first.file.toPath(), ABC);
            Path metadata = directory.resolve("candidate.properties");
            Properties properties = new Properties();
            try (InputStream in = Files.newInputStream(metadata)) { properties.load(in); }
            properties.setProperty("schema", "999");
            try (OutputStream out = Files.newOutputStream(metadata)) { properties.store(out, null); }
            fails(store::load);
            Path unrelated = directory.resolve("save.json"); Files.write(unrelated, ABC);
            store.forget(); assert Files.exists(unrelated) && store.load() == null;
        } finally { remove(directory); }
        Path empty = Files.createTempDirectory("updater-mismatch-");
        try {
            UpdateCandidateStore store = new UpdateCandidateStore(empty.toFile(), transport(connection(200, new byte[2])));
            fails(() -> store.download(release(1, ABC_SHA), new UpdateCancellation(), (n, t) -> {}));
            assert store.load() == null;
            assertNoPartials(empty);
        } finally { remove(empty); }
    }
    // A first transfer finishing after a newer one cannot promote over the newer selection.
    private static void staleTransferCannotReplaceFile() throws Exception {
        Path directory = Files.createTempDirectory("updater-stale-");
        CountDownLatch entered = new CountDownLatch(1), resume = new CountDownLatch(1);
        try {
            Connection slow = connection(200, ABC), fast = connection(200, ABC);
            slow.beforeRead = () -> { entered.countDown(); await(resume); };
            AtomicInteger opens = new AtomicInteger();
            UpdateCandidateStore store = new UpdateCandidateStore(directory.toFile(), new HttpsUpdateTransport(
                    url -> opens.getAndIncrement() == 0 ? slow : fast, new Clock()));
            AtomicReference<Throwable> failure = new AtomicReference<>();
            Thread old = new Thread(() -> { try { store.download(release(1, ABC_SHA), new UpdateCancellation(), (n, t) -> {}); }
                catch (Throwable e) { failure.set(e); } });
            old.start(); assert entered.await(5, TimeUnit.SECONDS);
            Candidate newer = store.download(release(2, ABC_SHA), new UpdateCancellation(), (n, t) -> {});
            resume.countDown(); old.join(5000);
            assert !old.isAlive() && failure.get() instanceof UpdatePorts.Failure;
            assert store.load().release.id == 2 && newer.file.isFile();
            assertNoPartials(directory);
            // A foreground exit invalidates the active generation and preserves complete candidates.
            Connection blocked = connection(200, ABC);
            CountDownLatch started = new CountDownLatch(1), finish = new CountDownLatch(1);
            blocked.beforeRead = () -> { started.countDown(); await(finish); };
            blocked.onDisconnect = finish::countDown;
            UpdateCandidateStore exiting = new UpdateCandidateStore(directory.toFile(), transport(blocked));
            AtomicReference<Throwable> cancelled = new AtomicReference<>();
            AtomicInteger callbacks = new AtomicInteger();
            Thread worker = new Thread(() -> { try { exiting.download(release(3, ABC_SHA), new UpdateCancellation(),
                    (n, t) -> callbacks.incrementAndGet()); } catch (Throwable e) { cancelled.set(e); } });
            worker.start(); assert started.await(5, TimeUnit.SECONDS);
            assert store.load().release.id == 2 : "Incomplete transfer changed old candidate";
            exiting.deletePartial(); worker.join(5000);
            assert !worker.isAlive() && cancelled.get() instanceof UpdatePorts.Failure;
            assert ((UpdatePorts.Failure) cancelled.get()).code.equals("cancelled");
            assert callbacks.get() == 0 && store.load().release.id == 2;
        } finally { resume.countDown(); remove(directory); }
    }
    // Teardown of the old socket cannot delete a new operation's private partial created meanwhile.
    private static void cleanupCannotDeleteNewTransfer() throws Exception {
        Path directory = Files.createTempDirectory("updater-cleanup-race-");
        CountDownLatch oldReading = new CountDownLatch(1), oldResume = new CountDownLatch(1);
        CountDownLatch cancelling = new CountDownLatch(1), cancelResume = new CountDownLatch(1);
        CountDownLatch newReading = new CountDownLatch(1), newResume = new CountDownLatch(1);
        try {
            Connection oldConnection = connection(200, ABC), newConnection = connection(200, ABC);
            oldConnection.beforeRead = () -> { oldReading.countDown(); await(oldResume); };
            oldConnection.onDisconnect = () -> { cancelling.countDown(); await(cancelResume); oldResume.countDown(); };
            newConnection.beforeRead = () -> { newReading.countDown(); await(newResume); };
            AtomicInteger opens = new AtomicInteger();
            UpdateCandidateStore store = new UpdateCandidateStore(directory.toFile(), new HttpsUpdateTransport(
                    url -> opens.getAndIncrement() == 0 ? oldConnection : newConnection, new Clock()));
            AtomicReference<Throwable> oldResult = new AtomicReference<>(), newResult = new AtomicReference<>(), deleteResult = new AtomicReference<>();
            Thread old = new Thread(() -> { try { store.download(release(1, ABC_SHA), new UpdateCancellation(), (n, t) -> {}); }
                catch (Throwable failure) { oldResult.set(failure); } });
            old.start(); assert oldReading.await(5, TimeUnit.SECONDS);
            Thread deleting = new Thread(() -> { try { store.deletePartial(); } catch (Throwable failure) { deleteResult.set(failure); } });
            deleting.start(); assert cancelling.await(5, TimeUnit.SECONDS);
            Thread newer = new Thread(() -> { try { store.download(release(2, ABC_SHA), new UpdateCancellation(), (n, t) -> {}); }
                catch (Throwable failure) { newResult.set(failure); } });
            newer.start(); assert newReading.await(5, TimeUnit.SECONDS);
            cancelResume.countDown(); deleting.join(5000); old.join(5000);
            assert !deleting.isAlive() && !old.isAlive() && deleteResult.get() == null;
            newResume.countDown(); newer.join(5000);
            assert !newer.isAlive() && newResult.get() == null : newResult.get();
            assert oldResult.get() instanceof UpdatePorts.Failure && store.load().release.id == 2;
        } finally { cancelResume.countDown(); oldResume.countDown(); newResume.countDown(); remove(directory); }
    }
    // Once forget captures the old generation, its delayed teardown cannot erase a later promotion.
    private static void delayedForgetPreservesNewCandidate() throws Exception {
        Path directory = Files.createTempDirectory("updater-forget-race-");
        CountDownLatch reading = new CountDownLatch(1), readResume = new CountDownLatch(1);
        CountDownLatch cancelling = new CountDownLatch(1), cancelResume = new CountDownLatch(1);
        Thread old = null, forgetting = null;
        try {
            Connection initial = connection(200, ABC), blocked = connection(200, ABC), fast = connection(200, ABC);
            blocked.beforeRead = () -> { reading.countDown(); await(readResume); };
            blocked.onDisconnect = () -> { cancelling.countDown(); await(cancelResume); readResume.countDown(); };
            AtomicInteger opens = new AtomicInteger();
            UpdateCandidateStore store = new UpdateCandidateStore(directory.toFile(), new HttpsUpdateTransport(url -> {
                int index = opens.getAndIncrement(); return index == 0 ? initial : index == 1 ? blocked : fast;
            }, new Clock()));
            store.download(release(1, ABC_SHA), new UpdateCancellation(), (n, t) -> {});
            AtomicReference<Throwable> oldResult = new AtomicReference<>(), forgetResult = new AtomicReference<>();
            old = new Thread(() -> { try { store.download(release(2, ABC_SHA), new UpdateCancellation(), (n, t) -> {}); }
                catch (Throwable failure) { oldResult.set(failure); } });
            old.start(); assert reading.await(5, TimeUnit.SECONDS);
            forgetting = new Thread(() -> { try { store.forget(); } catch (Throwable failure) { forgetResult.set(failure); } });
            forgetting.start(); assert cancelling.await(5, TimeUnit.SECONDS);
            Candidate newer = store.download(release(3, ABC_SHA), new UpdateCancellation(), (n, t) -> {});
            assert store.load().release.id == 3 && newer.file.isFile();
            cancelResume.countDown(); forgetting.join(5000); old.join(5000);
            assert !forgetting.isAlive() && !old.isAlive() && forgetResult.get() == null : forgetResult.get();
            assert oldResult.get() instanceof UpdatePorts.Failure;
            assert newer.file.isFile() : "Old forget deleted the newer successful APK";
            Candidate loaded = store.load();
            assert loaded != null && loaded.release.id == 3 : "Old forget deleted newer metadata";
            assertNoPartials(directory);
        } finally {
            cancelResume.countDown(); readResume.countDown();
            if (old != null) old.join(5000);
            if (forgetting != null) forgetting.join(5000);
            remove(directory);
        }
    }
    // Superseding closes each old transfer before opening new work; cleanup retains all ownership.
    private static void supersededTransfersRemainCancellable() throws Exception {
        Path directory = Files.createTempDirectory("updater-superseded-race-");
        CountDownLatch reading = new CountDownLatch(1), otherReading = new CountDownLatch(1);
        CountDownLatch readResume = new CountDownLatch(1), otherResume = new CountDownLatch(1);
        Thread old = null, other = null;
        try {
            Connection blocked = connection(200, ABC), alsoBlocked = connection(200, ABC), fast = connection(200, ABC);
            blocked.beforeRead = () -> { reading.countDown(); await(readResume); };
            blocked.onDisconnect = readResume::countDown;
            alsoBlocked.beforeRead = () -> { otherReading.countDown(); await(otherResume); };
            alsoBlocked.onDisconnect = otherResume::countDown;
            AtomicInteger opens = new AtomicInteger(), oldProgress = new AtomicInteger();
            UpdateCandidateStore store = new UpdateCandidateStore(directory.toFile(), new HttpsUpdateTransport(url -> {
                int index = opens.getAndIncrement(); return index == 0 ? blocked : index == 1 ? alsoBlocked : fast;
            }, new Clock()));
            AtomicReference<Throwable> oldResult = new AtomicReference<>(), otherResult = new AtomicReference<>();
            old = new Thread(() -> { try { store.download(release(1, ABC_SHA), new UpdateCancellation(),
                    (n, t) -> oldProgress.incrementAndGet()); } catch (Throwable failure) { oldResult.set(failure); } });
            other = new Thread(() -> { try { store.download(release(2, ABC_SHA), new UpdateCancellation(),
                    (n, t) -> oldProgress.incrementAndGet()); } catch (Throwable failure) { otherResult.set(failure); } });
            old.start(); assert reading.await(5, TimeUnit.SECONDS);
            other.start(); assert otherReading.await(5, TimeUnit.SECONDS);
            assert blocked.disconnected && blocked.closed : "Superseding did not promptly close the old connection";
            Candidate newer = store.download(release(3, ABC_SHA), new UpdateCancellation(), (n, t) -> {});
            assert alsoBlocked.disconnected && alsoBlocked.closed : "The newest transfer left its predecessor connected";
            store.deletePartial();
            assert blocked.disconnected && blocked.closed : "Foreground cleanup lost the superseded connection";
            assert alsoBlocked.disconnected && alsoBlocked.closed : "Foreground cleanup lost another superseded connection";
            old.join(5000); other.join(5000);
            assert !old.isAlive() && oldResult.get() instanceof UpdatePorts.Failure;
            assert !other.isAlive() && otherResult.get() instanceof UpdatePorts.Failure;
            assert ((UpdatePorts.Failure) oldResult.get()).code.equals("cancelled");
            assert ((UpdatePorts.Failure) otherResult.get()).code.equals("cancelled");
            assert oldProgress.get() == 0 && newer.file.isFile() && store.load().release.id == 3;
            assertNoPartials(directory);
        } finally {
            readResume.countDown(); otherResume.countDown();
            if (old != null) old.join(5000);
            if (other != null) other.join(5000);
            remove(directory);
        }
    }
    // A waiting superseder must itself be cancellable and must never open a late connection.
    private static void supersedingDuringDelayedTeardown() throws Exception {
        Path directory = Files.createTempDirectory("updater-superseding-teardown-");
        CountDownLatch reading = new CountDownLatch(1), readResume = new CountDownLatch(1);
        CountDownLatch closing = new CountDownLatch(1), closeResume = new CountDownLatch(1);
        Thread old = null, waiting = null;
        try {
            Connection blocked = connection(200, ABC), fast = connection(200, ABC);
            blocked.beforeRead = () -> { reading.countDown(); await(readResume); };
            blocked.onDisconnect = () -> { closing.countDown(); await(closeResume); readResume.countDown(); };
            AtomicInteger opens = new AtomicInteger();
            UpdateCandidateStore store = new UpdateCandidateStore(directory.toFile(), new HttpsUpdateTransport(
                    url -> opens.getAndIncrement() == 0 ? blocked : fast, new Clock()));
            AtomicReference<Throwable> oldResult = new AtomicReference<>(), waitingResult = new AtomicReference<>();
            old = new Thread(() -> { try { store.download(release(1, ABC_SHA), new UpdateCancellation(), (n, t) -> {}); }
                catch (Throwable failure) { oldResult.set(failure); } });
            old.start(); assert reading.await(5, TimeUnit.SECONDS);
            waiting = new Thread(() -> { try { store.download(release(2, ABC_SHA), new UpdateCancellation(), (n, t) -> {}); }
                catch (Throwable failure) { waitingResult.set(failure); } });
            waiting.start(); assert closing.await(5, TimeUnit.SECONDS);
            Candidate newer = store.download(release(3, ABC_SHA), new UpdateCancellation(), (n, t) -> {});
            closeResume.countDown(); waiting.join(5000); old.join(5000);
            assert !waiting.isAlive() && !old.isAlive() && opens.get() == 2 : "Waiting superseder opened a late connection";
            assert oldResult.get() instanceof UpdatePorts.Failure && waitingResult.get() instanceof UpdatePorts.Failure;
            assert ((UpdatePorts.Failure) waitingResult.get()).code.equals("cancelled");
            assert newer.file.isFile() && store.load().release.id == 3;
            assertNoPartials(directory);
        } finally {
            closeResume.countDown(); readResume.countDown();
            if (old != null) old.join(5000);
            if (waiting != null) waiting.join(5000);
            remove(directory);
        }
    }
    private static Release release(long id, String sha) {
        return new Release(id, "v0.12.0", new Version(0, 12, 0),
                new Asset(20, "block-ops-test.apk", URI_APK, 3, "sha256:" + sha), sha, "Summary");
    }
    private interface Checked { void run() throws Exception; }
    private static UpdatePorts.Failure fails(Checked operation) throws Exception {
        try { operation.run(); } catch (UpdatePorts.Failure failure) { return failure; }
        throw new AssertionError("Expected typed failure");
    }
    private static void await(CountDownLatch latch) {
        try { if (!latch.await(5, TimeUnit.SECONDS)) throw new AssertionError("Timed out"); }
        catch (InterruptedException e) { throw new AssertionError(e); }
    }
    private static void remove(Path directory) throws IOException {
        try (java.util.stream.Stream<Path> paths = Files.walk(directory)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toArray(Path[]::new)) Files.deleteIfExists(path);
        }
    }
    private static void assertNoPartials(Path directory) throws IOException {
        try (java.util.stream.Stream<Path> paths = Files.list(directory)) {
            assert paths.noneMatch(p -> p.getFileName().toString().endsWith(".part"));
        }
    }
    private static HttpsUpdateTransport transport(Connection c) { return new HttpsUpdateTransport(url -> c, new Clock()); }
    private static Connection connection(int status, byte[] bytes) throws Exception { return new Connection(URI_APK.toURL(), status, bytes); }
    private static final class Connection extends HttpsURLConnection {
        final int status; final byte[] bytes; final Map<String,String> headers = new HashMap<>();
        int bytesRead; volatile boolean closed, disconnected; Runnable beforeRead, afterRead, onDisconnect;
        RuntimeException responseFailure;
        Connection(URL url, int status, byte[] bytes) { super(url); this.status = status; this.bytes = bytes; }
        public int getResponseCode() { if (responseFailure != null) throw responseFailure; return status; }
        public String getHeaderField(String name) { return headers.get(name); }
        public InputStream getInputStream() {
            return new ByteArrayInputStream(bytes) {
                public synchronized int read(byte[] b, int off, int len) {
                    if (beforeRead != null) { Runnable run = beforeRead; beforeRead = null; run.run(); }
                    int n = super.read(b, off, len); if (n > 0) bytesRead += n;
                    if (afterRead != null && n > 0) afterRead.run(); return n;
                }
                public void close() { closed = true; }
            };
        }
        public void disconnect() { disconnected = true; if (onDisconnect != null) onDisconnect.run(); }
        public void connect() {} public boolean usingProxy() { return false; }
        public String getCipherSuite() { return "TLS"; }
        public Certificate[] getLocalCertificates() { return null; }
        public Certificate[] getServerCertificates() { return null; }
        public Principal getPeerPrincipal() { return null; }
        public Principal getLocalPrincipal() { return null; }
    }
}
