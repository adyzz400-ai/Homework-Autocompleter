async function runWithTimeout(
    actionFn,
    timeoutMs
) {
    let timeout;

    try {
        return await Promise.race([
            actionFn(),

            new Promise(
                (_, reject) => {
                    timeout = setTimeout(() => {
                        reject(
                            new Error(
                                `AI request timed out after ${timeoutMs}ms`
                            )
                        );
                    }, timeoutMs);
                }
            )
        ]);
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}

async function getAIanswer(
    actionFn,
    queue,
    interaction,
    progressUpdater,
    maxWaitMs = 30000,
    checkIntervalMs = 3000,
    cancelFlag = () => false
) {
    let attempts = 0;

    const maxAttempts = 3;

    while (
        !cancelFlag() &&
        attempts < maxAttempts
    ) {
        attempts++;

        try {
            await progressUpdater.updateEmbed(
                `AI is solving the question... (Attempt ${attempts}/${maxAttempts})`
            );

            const result =
                await runWithTimeout(
                    actionFn,
                    maxWaitMs
                );

            if (
                typeof result !== 'number'
            ) {
                return result;
            }

            await progressUpdater.updateEmbed(
                `AI returned error ${result}. Retrying...`
            );

        } catch (error) {
            console.error(
                `[AI] Attempt ${attempts} failed:`,
                error?.message || error
            );

            if (
                attempts >= maxAttempts
            ) {
                await progressUpdater.updateEmbed(
                    '❌ AI failed after 3 attempts.'
                );

                throw new Error(
                    `AI failed after ${maxAttempts} attempts: ${
                        error?.message || 'Unknown error'
                    }`
                );
            }

            await progressUpdater.updateEmbed(
                `AI request timed out or failed. Retrying... (${attempts}/${maxAttempts})`
            );
        }

        let elapsed = 0;

        while (
            elapsed < maxWaitMs &&
            !cancelFlag() &&
            (
                await queue.stillUsing(
                    interaction.user.id
                )
            )
        ) {
            const timeLeft =
                maxWaitMs - elapsed;

            const wait =
                Math.min(
                    checkIntervalMs,
                    timeLeft
                );

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        wait
                    )
            );

            elapsed += wait;
        }

        if (
            cancelFlag() ||
            !(
                await queue.stillUsing(
                    interaction.user.id
                )
            )
        ) {
            return 'break';
        }
    }

    if (cancelFlag()) {
        return 'break';
    }

    throw new Error(
        'AI failed after maximum retry attempts.'
    );
}

module.exports =
    getAIanswer;