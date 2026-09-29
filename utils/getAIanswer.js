async function runWithTimeout(
    actionFn,
    timeoutMs
) {
    return Promise.race([
        actionFn(),

        new Promise(
            (_, reject) => {
                setTimeout(
                    () => {
                        reject(
                            new Error(
                                `AI request timed out after ${timeoutMs}ms`
                            )
                        );
                    },
                    timeoutMs
                );
            }
        )
    ]);
}

async function getAIanswer(
    actionFn,
    queue,
    interaction,
    progressUpdater,
    maxWaitMs = 60000,
    checkIntervalMs = 3000,
    cancelFlag = () => false
) {
    let attempts = 0;

    while (!cancelFlag()) {
        attempts++;

        try {
            await progressUpdater.updateEmbed(
                'AI is solving the question...'
            );

            const result =
                await runWithTimeout(
                    actionFn,
                    60000
                );

            if (
                typeof result !==
                'number'
            ) {
                return result;
            }

            await progressUpdater.updateEmbed(
                `AI returned error ${result}. Retrying...`
            );

        } catch (error) {
            console.error(
                '[AI] Request failed:',
                error.message
            );

            await progressUpdater.updateEmbed(
                'AI request timed out or failed. Retrying...'
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
                maxWaitMs -
                elapsed;

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

    return 'break';
}

module.exports =
    getAIanswer;