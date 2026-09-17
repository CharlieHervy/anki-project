import pdfParse from "pdf-parse";

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text;
}

export async function extractTextFromTxt(buffer: Buffer): Promise<string> {
  return buffer.toString("utf-8");
}

export async function extractText(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop();

  if (ext === "pdf") {
    return extractTextFromPdf(buffer);
  } else if (ext === "txt") {
    return extractTextFromTxt(buffer);
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }
}
