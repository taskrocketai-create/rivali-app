function normalizeUsPhone(phone: string) {
  if (!phone) return "";
  if (phone.trim().startsWith("+")) return phone.trim();
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone.trim();
}

export async function sendTextMessage(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { sent: false, reason: "Twilio is not configured." };

  const payload = new URLSearchParams({ To: normalizeUsPhone(to), From: from, Body: body });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: payload,
  });
  if (!response.ok) {
    const error = await response.text();
    return { sent: false, reason: error.slice(0, 300) };
  }
  return { sent: true, reason: "" };
}
