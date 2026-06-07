/**
 * Debug logging for the HumanStep n8n node.
 * Logs appear in the n8n server console (stdout).
 *
 * Enabled by default. Set HUMANSTEP_N8N_DEBUG=0 or false to disable.
 */
function isDebugEnabled(): boolean {
	const flag = process.env.HUMANSTEP_N8N_DEBUG;
	return flag !== '0' && flag !== 'false';
}

function safeSerialize(data: unknown): string {
	try {
		return JSON.stringify(data);
	} catch {
		return String(data);
	}
}

export function humanStepDebug(scope: string, message: string, data?: unknown): void {
	if (!isDebugEnabled()) {
		return;
	}

	if (data === undefined) {
		console.log(`[HumanStep][${scope}] ${message}`);
		return;
	}

	console.log(`[HumanStep][${scope}] ${message}`, safeSerialize(data));
}
