import type { PipelineType } from "../pipelines.js";
import type { ChatCompletionInputMessage, GenerationParameters } from "../tasks/index.js";
import { stringifyGenerationConfig, stringifyMessages } from "./common.js";
import { getModelInputSnippet } from "./inputs.js";
import type { InferenceSnippet, ModelDataMinimal } from "./types.js";

const snippetImportInferenceClient = (model: ModelDataMinimal, accessToken: string): string =>
	`from huggingface_hub import InferenceClient
client = InferenceClient("${model.id}", token="${accessToken || "{API_TOKEN}"}")
`;

const snippetConversational = (
	model: ModelDataMinimal,
	accessToken: string,
	opts?: {
		streaming?: boolean;
		messages?: ChatCompletionInputMessage[];
		temperature?: GenerationParameters["temperature"];
		max_tokens?: GenerationParameters["max_tokens"];
		top_p?: GenerationParameters["top_p"];
	}
): InferenceSnippet[] => {
	const streaming = opts?.streaming ?? true;
	const exampleMessages = getModelInputSnippet(model) as ChatCompletionInputMessage[];
	const messages = opts?.messages ?? exampleMessages;
	const messagesStr = stringifyMessages(messages, { attributeKeyQuotes: true });

	const config = {
		...(opts?.temperature ? { temperature: opts.temperature } : undefined),
		max_tokens: opts?.max_tokens ?? 500,
		...(opts?.top_p ? { top_p: opts.top_p } : undefined),
	};
	const configStr = stringifyGenerationConfig(config, {
		indent: "\n\t",
		attributeValueConnector: "=",
	});

	if (streaming) {
		return [
			{
				client: "huggingface_hub",
				content: `from huggingface_hub import InferenceClient

client = InferenceClient(api_key="${accessToken || "{API_TOKEN}"}")

messages = ${messagesStr}

stream = client.chat.completions.create(
    model="${model.id}", 
	messages=messages, 
	${configStr},
	stream=True
)

for chunk in stream:
    print(chunk.choices[0].delta.content, end="")`,
			},
			{
				client: "openai",
				content: `from openai import OpenAI

client = OpenAI(
	base_url="https://api-inference.huggingface.co/v1/",
	api_key="${accessToken || "{API_TOKEN}"}"
)

messages = ${messagesStr}

stream = client.chat.completions.create(
    model="${model.id}", 
	messages=messages, 
	${configStr},
	stream=True
)

for chunk in stream:
    print(chunk.choices[0].delta.content, end="")`,
			},
		];
	} else {
		return [
			{
				client: "huggingface_hub",
				content: `from huggingface_hub import InferenceClient

client = InferenceClient(api_key="${accessToken || "{API_TOKEN}"}")

messages = ${messagesStr}

completion = client.chat.completions.create(
    model="${model.id}", 
	messages=messages, 
	${configStr}
)

print(completion.choices[0].message)`,
			},
			{
				client: "openai",
				content: `from openai import OpenAI

client = OpenAI(
	base_url="https://api-inference.huggingface.co/v1/",
	api_key="${accessToken || "{API_TOKEN}"}"
)

messages = ${messagesStr}

completion = client.chat.completions.create(
    model="${model.id}", 
	messages=messages, 
	${configStr}
)

print(completion.choices[0].message)`,
			},
		];
	}
};

const snippetZeroShotClassification = (model: ModelDataMinimal): InferenceSnippet => ({
	content: `def query(payload):
	response = requests.post(API_URL, headers=headers, json=payload)
	return response.json()

output = query({
    "inputs": ${getModelInputSnippet(model)},
    "parameters": {"candidate_labels": ["refund", "legal", "faq"]},
})`,
});

const snippetZeroShotImageClassification = (model: ModelDataMinimal): InferenceSnippet => ({
	content: `def query(data):
	with open(data["image_path"], "rb") as f:
		img = f.read()
	payload={
		"parameters": data["parameters"],
		"inputs": base64.b64encode(img).decode("utf-8")
	}
	response = requests.post(API_URL, headers=headers, json=payload)
	return response.json()

output = query({
    "image_path": ${getModelInputSnippet(model)},
    "parameters": {"candidate_labels": ["cat", "dog", "llama"]},
})`,
});

const snippetBasic = (model: ModelDataMinimal): InferenceSnippet => ({
	content: `def query(payload):
	response = requests.post(API_URL, headers=headers, json=payload)
	return response.json()
	
output = query({
	"inputs": ${getModelInputSnippet(model)},
})`,
});

const snippetFile = (model: ModelDataMinimal): InferenceSnippet => ({
	content: `def query(filename):
    with open(filename, "rb") as f:
        data = f.read()
    response = requests.post(API_URL, headers=headers, data=data)
    return response.json()

output = query(${getModelInputSnippet(model)})`,
});

const snippetTextToImage = (model: ModelDataMinimal, accessToken: string): InferenceSnippet[] => [
	{
		client: "huggingface_hub",
		content: `${snippetImportInferenceClient(model, accessToken)}
# output is a PIL.Image object
image = client.text_to_image(${getModelInputSnippet(model)})`,
	},
	{
		client: "requests",
		content: `def query(payload):
	response = requests.post(API_URL, headers=headers, json=payload)
	return response.content
image_bytes = query({
	"inputs": ${getModelInputSnippet(model)},
})

# You can access the image with PIL.Image for example
import io
from PIL import Image
image = Image.open(io.BytesIO(image_bytes))`,
	},
];

const snippetTabular = (model: ModelDataMinimal): InferenceSnippet => ({
	content: `def query(payload):
	response = requests.post(API_URL, headers=headers, json=payload)
	return response.content
response = query({
	"inputs": {"data": ${getModelInputSnippet(model)}},
})`,
});

const snippetTextToAudio = (model: ModelDataMinimal): InferenceSnippet => {
	// Transformers TTS pipeline and api-inference-community (AIC) pipeline outputs are diverged
	// with the latest update to inference-api (IA).
	// Transformers IA returns a byte object (wav file), whereas AIC returns wav and sampling_rate.
	if (model.library_name === "transformers") {
		return {
			content: `def query(payload):
	response = requests.post(API_URL, headers=headers, json=payload)
	return response.content

audio_bytes = query({
	"inputs": ${getModelInputSnippet(model)},
})
# You can access the audio with IPython.display for example
from IPython.display import Audio
Audio(audio_bytes)`,
		};
	} else {
		return {
			content: `def query(payload):
	response = requests.post(API_URL, headers=headers, json=payload)
	return response.json()
	
audio, sampling_rate = query({
	"inputs": ${getModelInputSnippet(model)},
})
# You can access the audio with IPython.display for example
from IPython.display import Audio
Audio(audio, rate=sampling_rate)`,
		};
	}
};

const snippetDocumentQuestionAnswering = (model: ModelDataMinimal, accessToken: string): InferenceSnippet[] => {
	const inputsAsStr = getModelInputSnippet(model) as string;
	const inputsAsObj = JSON.parse(inputsAsStr);

	return [
		{
			client: "huggingface_hub",
			content: `${snippetImportInferenceClient(model, accessToken)}
output = client.document_question_answering(${inputsAsObj.image}, question=${inputsAsObj.question})`,
		},
		{
			client: "requests",
			content: `def query(payload):
	with open(payload["image"], "rb") as f:
		img = f.read()
		payload["image"] = base64.b64encode(img).decode("utf-8")
	response = requests.post(API_URL, headers=headers, json=payload)
	return response.json()

output = query({
    "inputs": ${inputsAsStr},
})`,
		},
	];
};

const pythonSnippets: Partial<
	Record<
		PipelineType,
		(
			model: ModelDataMinimal,
			accessToken: string,
			opts?: Record<string, unknown>
		) => InferenceSnippet | InferenceSnippet[]
	>
> = {
	// Same order as in tasks/src/pipelines.ts
	"text-classification": snippetBasic,
	"token-classification": snippetBasic,
	"table-question-answering": snippetBasic,
	"question-answering": snippetBasic,
	"zero-shot-classification": snippetZeroShotClassification,
	translation: snippetBasic,
	summarization: snippetBasic,
	"feature-extraction": snippetBasic,
	"text-generation": snippetBasic,
	"text2text-generation": snippetBasic,
	"image-text-to-text": snippetConversational,
	"fill-mask": snippetBasic,
	"sentence-similarity": snippetBasic,
	"automatic-speech-recognition": snippetFile,
	"text-to-image": snippetTextToImage,
	"text-to-speech": snippetTextToAudio,
	"text-to-audio": snippetTextToAudio,
	"audio-to-audio": snippetFile,
	"audio-classification": snippetFile,
	"image-classification": snippetFile,
	"tabular-regression": snippetTabular,
	"tabular-classification": snippetTabular,
	"object-detection": snippetFile,
	"image-segmentation": snippetFile,
	"document-question-answering": snippetDocumentQuestionAnswering,
	"image-to-text": snippetFile,
	"zero-shot-image-classification": snippetZeroShotImageClassification,
};

export function getPythonInferenceSnippet(
	model: ModelDataMinimal,
	accessToken: string,
	opts?: Record<string, unknown>
): InferenceSnippet | InferenceSnippet[] {
	if (model.tags.includes("conversational")) {
		// Conversational model detected, so we display a code snippet that features the Messages API
		return snippetConversational(model, accessToken, opts);
	} else {
		let snippets =
			model.pipeline_tag && model.pipeline_tag in pythonSnippets
				? pythonSnippets[model.pipeline_tag]?.(model, accessToken) ?? { content: "" }
				: { content: "" };

		snippets = Array.isArray(snippets) ? snippets : [snippets];

		return snippets.map((snippet) => {
			return {
				...snippet,
				content: snippet.content.includes("requests")
					? `import requests

API_URL = "https://api-inference.huggingface.co/models/${model.id}"
headers = {"Authorization": ${accessToken ? `"Bearer ${accessToken}"` : `f"Bearer {API_TOKEN}"`}}

${snippet.content}`
					: snippet.content,
			};
		});
	}
}

export function hasPythonInferenceSnippet(model: ModelDataMinimal): boolean {
	return !!model.pipeline_tag && model.pipeline_tag in pythonSnippets;
}
