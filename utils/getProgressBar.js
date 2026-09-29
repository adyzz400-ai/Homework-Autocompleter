const sharp = require('sharp');
const path = require('path');

const PROGRESS_DIR = path.join(
    __dirname,
    '..',
    'emojis',
    'progress_bar'
);

const BAR_HEIGHT = 48;
const BAR_WIDTH = 48;

async function loadPart(name) {
    return sharp(
        path.join(
            PROGRESS_DIR,
            `${name}.png`
        )
    )
        .resize(BAR_WIDTH, BAR_HEIGHT)
        .png()
        .toBuffer();
}

async function getProgressBar(
    current,
    total
) {
    current = Number(current) || 0;
    total = Number(total) || 1;

    const progress = Math.max(
        0,
        Math.min(1, current / total)
    );

    const filled = Math.round(
        progress * 10
    );

    const parts = [];

    for (let i = 0; i < 10; i++) {
        let name;

        if (i === 0) {
            name =
                filled > 0
                    ? 'left_full'
                    : 'left_empty';
        } else if (i === 9) {
            name =
                filled >= 10
                    ? 'right_full'
                    : 'right_empty';
        } else {
            name =
                i < filled
                    ? 'mid_full'
                    : 'mid_empty';
        }

        parts.push(
            await loadPart(name)
        );
    }

    return sharp({
        create: {
            width: BAR_WIDTH * 10,
            height: BAR_HEIGHT,
            channels: 4,
            background: {
                r: 0,
                g: 0,
                b: 0,
                alpha: 0
            }
        }
    })
        .composite(
            parts.map(
                (input, index) => ({
                    input,
                    left:
                        index *
                        BAR_WIDTH,
                    top: 0
                })
            )
        )
        .png()
        .toBuffer();
}

module.exports = getProgressBar;