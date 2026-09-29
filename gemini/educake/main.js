require('dotenv').config();

const { GoogleGenAI, Type } = require("@google/genai");

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    throw new Error(
        'GEMINI_API_KEY is missing from the environment.'
    );
}

class geminiAnswers {
    constructor() {
        this.ai = new GoogleGenAI({
            apiKey: apiKey
        });
    }

    async answerQuestion(questionObj, model) {
        try {
            const contents = [];

            // Add question image if there is one
            if (questionObj.image) {
                const responseImage =
                    await fetch(questionObj.image);

                if (!responseImage.ok) {
                    throw new Error(
                        `Failed to download question image: HTTP ${responseImage.status}`
                    );
                }

                const imageArrayBuffer =
                    await responseImage.arrayBuffer();

                const base64ImageData =
                    Buffer
                        .from(imageArrayBuffer)
                        .toString('base64');

                const contentType =
                    responseImage.headers.get(
                        'content-type'
                    ) || 'image/jpeg';

                contents.push({
                    inlineData: {
                        mimeType: contentType,
                        data: base64ImageData
                    }
                });
            }

            // Add question text
            contents.push({
                text: questionObj.question
            });

            let properties;

            // Multiple-choice question
            if (questionObj.choices) {
                properties = {
                    answer: {
                        type: Type.STRING,
                        enum: Object.values(
                            questionObj.choices
                        ),
                        description:
                            "Pick the correct answer from the list."
                    }
                };

            // Number question
            } else if (questionObj.type === 'number') {
                properties = {
                    answer: {
                        type: Type.NUMBER
                    }
                };

            // Normal text question
            } else {
                properties = {
                    answer: {
                        type: Type.STRING,
                        description:
                            "Keep your answer concise and use key words. YOUR ANSWER MUST BE NO LONGER THAN THREE WORDS."
                    }
                };
            }

            const response =
                await this.ai.models.generateContent({
                    model: `gemini-${model}`,

                    contents: contents,

                    config: {
                        responseMimeType:
                            "application/json",

                        responseSchema: {
                            type: Type.OBJECT,

                            properties: properties,

                            required:
                                Object.keys(properties),

                            propertyOrdering:
                                Object.keys(properties)
                        }
                    }
                });

            let raw =
                response
                    .candidates?.[0]
                    ?.content
                    ?.parts?.[0]
                    ?.text
                    ?.trim();

            if (!raw) {
                throw new Error(
                    'Gemini returned an empty response.'
                );
            }

            // Remove Markdown JSON fences if Gemini adds them
            raw = raw
                .replace(
                    /^```(?:json)?\s*/i,
                    ''
                )
                .replace(
                    /```$/,
                    ''
                )
                .trim();

            const answerObj =
                JSON.parse(raw);

            // Convert number answers to strings
            if (questionObj.type === 'number') {
                answerObj.answer =
                    String(answerObj.answer);
            }

            if (
                typeof answerObj.answer !== 'string'
            ) {
                answerObj.answer =
                    String(answerObj.answer);
            }

            console.log(
                'Answer response',
                answerObj.answer
            );

            // Escape single quotes for Educake
            answerObj.answer =
                answerObj.answer.replace(
                    /'/g,
                    "'\\''"
                );

            return answerObj.answer;

        } catch (err) {
            let parsed = err;

            if (err instanceof Error) {
                try {
                    parsed =
                        JSON.parse(err.message);
                } catch {
                    parsed = err;
                }
            }

            if (typeof err === "string") {
                try {
                    parsed =
                        JSON.parse(err);
                } catch {
                    parsed = {
                        error: {
                            message: err
                        }
                    };
                }
            }

            if (
                parsed?.error?.code == 503
            ) {
                return 503;
            }

            throw err;
        }
    }
}

const geminiAnswer =
    new geminiAnswers();

module.exports = {
    geminiAnswer
};