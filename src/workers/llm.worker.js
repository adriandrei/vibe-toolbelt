import { CreateMLCEngine } from '@mlc-ai/web-llm'

let engine = null
let currentModel = null

self.onmessage = async (event) => {
    const { type, payload, id } = event.data

    if (type === 'LOAD') {
        const { modelId } = payload
        if (currentModel === modelId && engine) {
            self.postMessage({ type: 'LOAD_DONE', id })
            return
        }
        try {
            engine = await CreateMLCEngine(modelId, {
                initProgressCallback: (progress) => {
                    self.postMessage({
                        type: 'LOAD_PROGRESS',
                        id,
                        payload: {
                            progress: progress.progress,
                            text: progress.text,
                        }
                    })
                }
            })
            currentModel = modelId
            self.postMessage({ type: 'LOAD_DONE', id })
        } catch (err) {
            self.postMessage({ type: 'ERROR', id, payload: { message: err.message } })
        }
        return
    }

    if (type === 'CHAT') {
        if (!engine) {
            self.postMessage({ type: 'ERROR', id, payload: { message: 'Engine not loaded' } })
            return
        }
        try {
            const { messages } = payload
            const stream = await engine.chat.completions.create({
                messages,
                stream: true,
                temperature: 0.7,
                max_tokens: 1024,
            })

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || ''
                if (content) {
                    self.postMessage({ type: 'CHAT_TOKEN', id, payload: { token: content } })
                }
            }
            self.postMessage({ type: 'CHAT_DONE', id })
        } catch (err) {
            if (err.name === 'AbortError') {
                self.postMessage({ type: 'CHAT_ABORTED', id })
            } else {
                self.postMessage({ type: 'ERROR', id, payload: { message: err.message } })
            }
        }
        return
    }

    if (type === 'ABORT') {
        if (engine) {
            try { await engine.interruptGenerate() } catch (_) {}
        }
        self.postMessage({ type: 'CHAT_ABORTED', id })
        return
    }
}
