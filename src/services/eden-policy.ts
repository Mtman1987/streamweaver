export function isEdenContentPolicyRejection(status: number, body: string): boolean {
  const normalized = String(body || '').toLowerCase();
  return status === 400 &&
    normalized.includes('content rejected due to the violation') &&
    normalized.includes('"code":"invalid_parameter"');
}
