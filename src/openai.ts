class OpenAiSpec {
    constructor() {
    }

    getSpec() {
        return {
            "openai": "3.1.0",
            "info": {
                "title": "Walcron AI API",
                "version": "1.0.0"
            },
            "paths": {}
        }
    }
}

export const openAiSpec = new OpenAiSpec();
