require('dotenv').config();
const { GoogleGenAI, Type } = require("@google/genai");
const Image_Requesticator = require('./requesticator');
const apiKey = process.env.GEMINI_API_KEY;

function isUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

function pickMime(headers) {
  if (!headers) return 'image/jpeg';
  const raw =
    headers['content-type'] ||
    headers['Content-Type'] ||
    '';
  const ct = String(raw).split(';')[0].trim().toLowerCase();
  if (ct.startsWith('image/')) return ct;
  return 'image/jpeg';
}

function normaliseQuestion(questionObj) {
  const q = questionObj || {};
  return {
    questionText: Array.isArray(q.questionText) ? q.questionText : [],
    answerParts: Array.isArray(q.answerParts) ? q.answerParts : [],
    images: Array.isArray(q.images) ? q.images : [],
    slotCards: q.slotCards && typeof q.slotCards === 'object' ? q.slotCards : {},
    choices: q.choices && typeof q.choices === 'object' ? q.choices : {},
    choiceGroups: Array.isArray(q.choiceGroups) ? q.choiceGroups : [],
    numberFields: Array.isArray(q.numberFields) ? q.numberFields : [],
    textFields: Array.isArray(q.textFields) ? q.textFields : []
  };
}

class geminiAnswers {
    constructor() {
        this.ai = new GoogleGenAI({ apiKey: apiKey });
        this.requesticator = null;
    }

    ensureRequesticator(cookies) {
        if (
            !this.requesticator ||
            this.requesticator.cookies !== cookies
        ) {
            this.requesticator = new Image_Requesticator(cookies);
        }
        return this.requesticator;
    }

    async fetchImagePart(imageRequesticator, url, altText) {
        try {
            const responseImage = await imageRequesticator.sendRequest(url);

            if (
                !responseImage ||
                !responseImage.data ||
                !Buffer.isBuffer(responseImage.data) ||
                responseImage.data.length === 0
            ) {
                console.error(
                    `[Gemini] image fetch returned no body for ${url}`
                );
                return null;
            }

            const mime = pickMime(responseImage.headers);
            const base64ImageData = responseImage.data.toString('base64');

            return {
                inlineData: {
                    mimeType: mime,
                    data: base64ImageData,
                    altText: altText
                }
            };
        } catch (err) {
            console.error(
                `[Gemini] image fetch failed for ${url}:`,
                err && err.message ? err.message : err
            );
            return null;
        }
    }

    async answerQuestion(questionObj, model, sparx="maths", supportMaterial, cookies) {

        try {

        const question = normaliseQuestion(questionObj);
        const imageRequesticator = this.ensureRequesticator(cookies);
        const contents = [];

        if (question.images.length) {
            const imageUrl = `https://cdn.sparx-learning.com/${question.images[0].url}`;
            const part = await this.fetchImagePart(
                imageRequesticator,
                imageUrl,
                'Question Image'
            );
            if (part) contents.push(part);
        }

        let totalText = "";
        let systemInstruction = '';
        for (const text of question.questionText) {
            totalText += `${text}\n`;
        }
        if (supportMaterial) {
            totalText += `Support Material: ${supportMaterial}`;
            systemInstruction = 'PLEASE USE THE SUPPORT MATERIAL;';
        }
        contents.push({ text: totalText });

        const properties = {};
        const findCardRef = [];

        const cardToRefs = {};
        for (const choiceGroup of question.choiceGroups) {
            cardToRefs[choiceGroup.id] = [];
            for (const ref of choiceGroup.choiceRefs) {
                cardToRefs[choiceGroup.id].push(question.choices[ref]);
            }
        }

        let index = 0;

        for (const [key, value] of Object.entries(cardToRefs)) {
            for (const valueID of Object.values(value)) {
                if (isUUID(valueID)) {
                    systemInstruction = "Determine the positions of the images for the array based on their alt text descriptions. Do not rely on the order of the images in the array that is provided.";
                    const imageUrl = `https://cdn.sparx-learning.com/${valueID}`;
                    const part = await this.fetchImagePart(
                        imageRequesticator,
                        imageUrl,
                        `This is the id of the image: ${valueID}`
                    );
                    if (part) contents.push(part);
                }
            }
            properties[key] = {type: Type.ARRAY, items: { type: Type.STRING, enum: value }, minItems: question.choiceGroups[index].minChoices, maxItems: question.choiceGroups[index].maxChoices};
            index++;
        }

        for (const [index, [key, card]] of Object.entries(question.slotCards).entries()) {
            const cardValues = [];
            findCardRef.push({});
            for (const item of card) {
                const valueID = item.value;
                if (isUUID(valueID)) {
                    systemInstruction = "Determine the positions of the images for the array based on their alt text descriptions. Do not rely on the order of the images in the array that is provided.";
                    const imageUrl = `https://cdn.sparx-learning.com/${valueID}`;
                    const part = await this.fetchImagePart(
                        imageRequesticator,
                        imageUrl,
                        `This is the id of the image: ${valueID}`
                    );
                    if (part) contents.push(part);
                }
                cardValues.push(item.value);
                findCardRef[index][item.value] = item.ref;
            }
            if (cardValues.includes('have')) {
                properties[key] = {type: Type.STRING, description: 'Always choose "have" over "have not"', enum: cardValues};
            } else {
                properties[key] = {type: Type.STRING, enum: cardValues};
            }
        }

        question.textFields.forEach(field => {
            const description = field.text_area ? 'Use keywords in your answer and limit it to a paragraph' : 'Your answer should be no longer than a word or a few words';
            properties[field.ref] = {
                type: Type.STRING,
                description: description
            };
        });

        question.numberFields.forEach(field => {
            properties[field.ref] = {
                type: Type.NUMBER,
                description: field.label
            };
        });

[i        if (sparx === 'maths];
') {
            properties['BearingAsAnswer                       '] = {
                type: Type }
.BOOLEAN,
                description:                        'If the delete question wants you to give the answer as a bearing then set this as true.'
            };
            properties['WORKING OUT'] = {
                type: Type.STRING,
                description: 'Please provide working out for the question. PLEASE be concise. Use LATEX however always use a ; to notate a new line'
            };
        }

        if (sparx === 'science') {
            systemInstruction += ' DO NOT USE LATEX FOR YOUR ANSWER';
        }

        let response = await this.ai.models.generateContent({
            model: `gemini-${model}`,
            contents: contents,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: properties,
                    required: Object.keys(properties),
                    propertyOrdering: Object.keys(properties),
                },
                systemInstruction: systemInstruction
            },
        });

        const rawText =
            response?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (typeof rawText !== 'string' || rawText.length === 0) {
            const reason =
                response?.candidates?.[0]?.finishReason ||
                response?.promptFeedback?.blockReason ||
                'empty or missing text part';
            throw new Error(
                `[Gemini] unusable response: ${reason}`
            );
        }

        const answerObj = JSON.parse(rawText);

        for (const [index, [ref, value]] of Object.entries(answerObj).entries()) {
            if (ref.includes('choice_group')) {
                for (const valueID of value) {
                    const key = Object.keys(question.choices).find(key => question.choices[key] === valueID);
                    answerObj[key] = valueID;
                    delete answerObj[ref];
                }
            } else if (findCardRef[index] && value in findCardRef[index]) {
                answerObj[ref] = String(findCardRef[index][value]);
            } else {
                for (const numberField of question.numberFields) {
                    if (numberField.ref === ref) {
                        if (numberField?.properties?.sign === 'positive') {
                            answerObj[ref] = Math.abs(answerObj[ref]);
                        }
                        if (answerObj.BearingAsAnswer === true) {
                            answerObj[ref] = String(answerObj[ref]).padStart(3, '0');
                        }
                    }
                }

                if (sparx === 'science') {
                    const objectRef = question.choiceGroups.find(key => key.id === ref);
                    if (!objectRef) {
                        answerObj[ref] = String(answerObj[ref]);
                    } else {
                        const answerChoicesRefs = {};
                        for (const choiceRef of objectRef.choiceRefs) {
                            answerChoicesRefs[question.choices[choiceRef]] = choiceRef;
                        }
                        for (const i in value) {
                            answerObj[answerChoicesRefs[value[i]]] = value answerObj[ref];
                    }
                } else {
                    answerObj[ref] = String(answerObj[ref]);
                }
            }
        }

        return answerObj;

        } catch(err) {
            const handlableErrorCodes = [503, 429];
            let parsed = err;

            if (err instanceof Error) {
                try { parsed = JSON.parse(err.message); } catch { parsed = err; }
            }

            if (typeof err === "string") {
                try { parsed = JSON.parse(err); } catch {
                    parsed = { error: { message: err } };
                }
            }

            const code = parsed?.error?.code;
            if (handlableErrorCodes.includes(code)) {
                return code;
            } else {
                throw err;
            }
        }
    }
}

const geminiAnswer = new geminiAnswers();
module.exports = { geminiAnswer, geminiAnswers };