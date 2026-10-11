/**
 * Writes a JSON artifact to the device and opens the native share sheet so
 * the user can hand it off to whatever machine runs cartune_orchestrator.py
 * — AirDrop/Nearby Share, email, a cloud-drive app, or saving to a folder
 * that syncs. This app never transmits the file anywhere on its own; the
 * human picks the transport, same "you review, you decide" posture as every
 * other handoff in the design doc.
 */

import RNFS from "react-native-fs";
import Share from "react-native-share";

export async function exportJsonFile(filename: string, data: unknown): Promise<string> {
  const path = `${RNFS.DocumentDirectoryPath}/${filename}`;
  await RNFS.writeFile(path, JSON.stringify(data, null, 2), "utf8");
  await Share.open({
    title: `Share ${filename}`,
    url: `file://${path}`,
    type: "application/json",
    failOnCancel: false,
  });
  return path;
}

/** Same hand-off for text artifacts (diagnostic report HTML, live-data CSV). */
export async function exportTextFile(filename: string, text: string, mime: string): Promise<string> {
  const path = `${RNFS.DocumentDirectoryPath}/${filename}`;
  await RNFS.writeFile(path, text, "utf8");
  await Share.open({ title: `Share ${filename}`, url: `file://${path}`, type: mime, failOnCancel: false });
  return path;
}
