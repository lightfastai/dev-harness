export default {
	portless: {
		name: "mfe",
		port: 1355,
		https: false,
	},
	target: {
		path: "/sign-in",
	},
	vercelMicrofrontends: {
		sourceConfig: "apps/app/microfrontends.json",
		generatedConfig: ".turbo/microfrontends.local.json",
		packageConfigFilename: "microfrontends.local.json",
	},
};
