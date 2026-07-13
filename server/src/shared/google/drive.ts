import { google, Auth } from "googleapis";

export interface DriveSpreadsheet {
  spreadsheetId: string;
  name: string;
  ownedByMe: boolean;
  modifiedTime: string;
}

const MAX_FILES = 300;

export async function listSpreadsheets(
  auth: Auth.OAuth2Client
): Promise<DriveSpreadsheet[]> {
  const drive = google.drive({ version: "v3", auth });
  const out: DriveSpreadsheet[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: "nextPageToken, files(id,name,ownedByMe,modifiedTime)",
      orderBy: "modifiedTime desc",
      pageSize: 100,
      pageToken,
      corpora: "user",
      spaces: "drive",
      includeItemsFromAllDrives: false,
      supportsAllDrives: false,
    });

    for (const f of res.data.files ?? []) {
      if (!f.id) continue;
      out.push({
        spreadsheetId: f.id,
        name: f.name ?? f.id,
        ownedByMe: f.ownedByMe ?? false,
        modifiedTime: f.modifiedTime ?? "",
      });
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && out.length < MAX_FILES);

  return out;
}

// Move a spreadsheet to the Drive trash (recoverable for ~30 days) rather
// than deleting permanently.
export async function trashSpreadsheet(
  spreadsheetId: string,
  auth: Auth.OAuth2Client
): Promise<void> {
  const drive = google.drive({ version: "v3", auth });
  await drive.files.update({ fileId: spreadsheetId, requestBody: { trashed: true } });
}

export async function restoreSpreadsheet(
  spreadsheetId: string,
  auth: Auth.OAuth2Client
): Promise<void> {
  const drive = google.drive({ version: "v3", auth });
  await drive.files.update({ fileId: spreadsheetId, requestBody: { trashed: false } });
}

// Permanently delete — skips trash, unrecoverable.
export async function deleteSpreadsheetForever(
  spreadsheetId: string,
  auth: Auth.OAuth2Client
): Promise<void> {
  const drive = google.drive({ version: "v3", auth });
  await drive.files.delete({ fileId: spreadsheetId });
}

// Spreadsheets currently in the Drive trash.
export async function listTrashedSpreadsheets(
  auth: Auth.OAuth2Client
): Promise<DriveSpreadsheet[]> {
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=true",
    fields: "files(id,name,ownedByMe,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 100,
    corpora: "user",
    spaces: "drive",
    includeItemsFromAllDrives: false,
    supportsAllDrives: false,
  });
  return (res.data.files ?? [])
    .filter((f) => !!f.id)
    .map((f) => ({
      spreadsheetId: f.id!,
      name: f.name ?? f.id!,
      ownedByMe: f.ownedByMe ?? false,
      modifiedTime: f.modifiedTime ?? "",
    }));
}
