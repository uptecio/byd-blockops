package au.local.blockops.updates;

import java.io.Closeable;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/** One operation's cancellation token and owned, interruptible resources. */
public final class UpdateCancellation {
    private volatile boolean cancelled;
    private final List<Closeable> resources = new ArrayList<>();

    public void check() throws UpdatePorts.Failure {
        if (cancelled) throw new UpdatePorts.Failure("cancelled", "Update cancelled.");
    }

    public void register(Closeable resource) {
        Objects.requireNonNull(resource);
        synchronized (this) {
            if (!cancelled) {
                resources.add(resource);
                return;
            }
        }
        close(resource);
    }

    public void cancel() {
        List<Closeable> pending;
        synchronized (this) {
            if (cancelled) return;
            cancelled = true;
            pending = new ArrayList<>(resources);
            resources.clear();
        }
        for (Closeable resource : pending) close(resource);
    }

    private static void close(Closeable resource) {
        try { resource.close(); }
        catch (IOException | RuntimeException ignored) { /* Continue closing the remaining resources. */ }
    }
}
