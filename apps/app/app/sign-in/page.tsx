import { appRuntimeIdentity } from "../../lib/runtime-identity";

export default function SignInPage() {
	return (
		<main>
			<p>app: /sign-in</p>
			<p>runtime: {appRuntimeIdentity.name}</p>
			<p>
				<a href="/api/db">db probe</a>
			</p>
			<p>
				<a href="/api/redis">redis probe</a>
			</p>
		</main>
	);
}
