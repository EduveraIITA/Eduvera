/**
 * Bound composition fan-out across workspace requests before native services
 * acquire database clients. Simulation transactions can wait on the same COW
 * gate, so starting every projection at once would fill its shared pool with
 * lock waiters and starve environment/control reads. This is scheduling only:
 * each caller keeps its own execution context, authority checks and result.
 */
export class WorkspaceProjectionReads {
    maxConcurrent;
    active = 0;
    waiting = [];
    constructor(maxConcurrent = 3) {
        this.maxConcurrent = maxConcurrent;
        if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
            throw new Error("Workspace projection concurrency must be a positive integer.");
        }
    }
    async run(operation) {
        if (this.active < this.maxConcurrent)
            this.active += 1;
        else
            await new Promise(resolve => this.waiting.push(resolve));
        // Invoke after the originating async continuation resumes, not from the
        // previous caller's release callback: selected-world AsyncLocalStorage must
        // not leak between queued requests.
        try {
            return await operation();
        }
        finally {
            const next = this.waiting.shift();
            if (next)
                next(); // Transfer this occupied slot to the oldest waiter.
            else
                this.active -= 1;
        }
    }
}
//# sourceMappingURL=workspace-projection-reads.js.map