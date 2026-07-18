class OpenApiSpec {
    constructor() {
    }

    getSpec() {
        return {
            "openapi": "3.1.0",
            "info": {
                "title": "WalCron API",
                "version": "1.0.0"
            },
            "paths": {}
        }
    }
}

export const openApiSpec = new OpenApiSpec();
