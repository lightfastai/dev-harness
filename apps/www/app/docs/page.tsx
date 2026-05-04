import { wwwRuntimeIdentity } from "../../lib/runtime-identity";

export default function DocsPage() {
	return (
		<main>
			<p>www: /docs</p>
			<p>runtime: {wwwRuntimeIdentity.name}</p>
			<p>
				<a href="/api/db">db probe</a>
			</p>
		</main>
	);
}
