// ==========================================================
// EDUCAKE HOMEWORK QUEUE
// ==========================================================

const jobs = [];
const entries = new Map();

let running = false;

// ----------------------------------------------------------
// GET QUEUE STATUS
// ----------------------------------------------------------

function getStatus(userId) {
    const entry = entries.get(userId);

    if (!entry) {
        return {
            inQueue: false,
            position: null,
            total: jobs.length + (running ? 1 : 0)
        };
    }

    if (entry.status === 'running') {
        return {
            inQueue: true,
            status: 'running',
            position: 1,
            total: jobs.length + 1
        };
    }

    const index = jobs.findIndex(
        job => job.userId === userId
    );

    return {
        inQueue: true,
        status: 'queued',
        position: index + (running ? 2 : 1),
        total: jobs.length + (running ? 1 : 0)
    };
}

// ----------------------------------------------------------
// PROCESS NEXT JOB
// ----------------------------------------------------------

async function processNext() {
    if (running || jobs.length === 0) {
        return;
    }

    const job = jobs.shift();

    const entry =
        entries.get(job.userId);

    if (!entry) {
        return processNext();
    }

    running = true;
    entry.status = 'running';

    try {
        await job.task();

        job.resolve();
    } catch (error) {
        job.reject(error);
    } finally {
        entries.delete(job.userId);

        running = false;

        void processNext();
    }
}

// ----------------------------------------------------------
// ADD JOB
// ----------------------------------------------------------

function enqueue(userId, task) {
    if (entries.has(userId)) {
        return {
            duplicate: true,
            status: getStatus(userId),
            promise: Promise.resolve()
        };
    }

    let resolvePromise;
    let rejectPromise;

    const promise =
        new Promise((resolve, reject) => {
            resolvePromise = resolve;
            rejectPromise = reject;
        });

    entries.set(userId, {
        status: 'queued'
    });

    jobs.push({
        userId,
        task,
        resolve: resolvePromise,
        reject: rejectPromise
    });

    const status =
        getStatus(userId);

    void processNext();

    return {
        duplicate: false,
        status,
        promise
    };
}

// ----------------------------------------------------------
// EXPORT
// ----------------------------------------------------------

module.exports = {
    enqueue,
    getStatus
};