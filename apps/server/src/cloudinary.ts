import * as crypto from "node:crypto";

interface CloudinaryUploadResult {
  secure_url?: string;
  public_id?: string;
  error?: { message?: string };
}

const cloudinaryConfig = () => {
  const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim() ?? "";
  let urlCloudName = "";
  let urlApiKey = "";
  let urlApiSecret = "";
  if (cloudinaryUrl) {
    try {
      const parsed = new URL(cloudinaryUrl);
      urlCloudName = parsed.hostname;
      urlApiKey = decodeURIComponent(parsed.username);
      urlApiSecret = decodeURIComponent(parsed.password);
    } catch {
      throw new Error("CLOUDINARY_URL is invalid.");
    }
  }
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME?.trim() || urlCloudName,
    apiKey: process.env.CLOUDINARY_API_KEY?.trim() || urlApiKey,
    apiSecret: process.env.CLOUDINARY_API_SECRET?.trim() || urlApiSecret,
    folder: process.env.CLOUDINARY_FOLDER?.trim() || "aviator/payments"
  };
};

export async function uploadPaymentReceipt(fileDataUrl: string): Promise<{ secureUrl: string; publicId: string }> {
  const config = cloudinaryConfig();
  if (!config.cloudName || !config.apiKey || !config.apiSecret) {
    throw new Error("Cloudinary receipt uploads are not configured.");
  }
  if (!/^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(fileDataUrl)) {
    throw new Error("Payment receipt must be a JPEG, PNG, or WebP image.");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signatureParams = `folder=${config.folder}&timestamp=${timestamp}`;
  const signature = crypto.createHash("sha1").update(`${signatureParams}${config.apiSecret}`).digest("hex");
  const body = new FormData();
  body.append("file", fileDataUrl);
  body.append("api_key", config.apiKey);
  body.append("timestamp", String(timestamp));
  body.append("folder", config.folder);
  body.append("signature", signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`, { method: "POST", body });
  const result = await response.json() as CloudinaryUploadResult;
  if (!response.ok || !result.secure_url) throw new Error(result.error?.message || "Payment receipt upload failed.");
  return { secureUrl: result.secure_url, publicId: result.public_id ?? "" };
}
