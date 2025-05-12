
"use server";

import { malwarePatterns } from "@/lib/malware-patterns";
import { summarizeAnalysisResults } from "@/ai/flows/summarize-analysis";

interface AnalyzeFileInput {
  fileName: string;
  fileContent: string; // Base64 encoded content, potentially a data URL
  contentType: string;
}

interface AnalyzeFileOutput {
  findings?: { pattern: string; category: string }[];
  summary?: string;
  error?: string;
  // isApk?: boolean; // Removed APK flag
}

// Performs pattern matching on the provided content (decoded or raw Base64)
function findMaliciousPatterns(content: string): { pattern: string; category: string }[] {
  const findings: { pattern: string; category: string }[] = [];
  const checkedPatterns = new Set<string>();

  const MAX_CONTENT_LENGTH_FOR_SCAN = 50 * 1024 * 1024; // 50 MB limit
  const isLargeContent = content.length > MAX_CONTENT_LENGTH_FOR_SCAN;

  if (isLargeContent) {
      console.warn(`[Pattern Match] Content length (${content.length}) exceeds ${MAX_CONTENT_LENGTH_FOR_SCAN} bytes. Scan performance might be impacted.`);
  }


  for (const category in malwarePatterns) {
    for (const pattern of malwarePatterns[category]) {
      const patternKey = `${category}:${pattern}`;
      if (checkedPatterns.has(patternKey)) {
          continue;
      }

      try {
        const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedPattern, 'i');

        if (regex.test(content)) {
            findings.push({ pattern, category });
            checkedPatterns.add(patternKey);
            if (findings.length <= 10) {
                 // console.log(`Pattern found: Category=${category}, Pattern=${pattern}`);
            } else if (findings.length === 11) {
                 // console.log(`Pattern found: ... (further matches suppressed)`);
            }
        }
      } catch (regexError) {
          console.error(`[Pattern Match] Error creating/testing regex for pattern "${pattern}":`, regexError);
           if (!isLargeContent && content.toLowerCase().includes(pattern.toLowerCase())) {
               if (!checkedPatterns.has(patternKey)) {
                  findings.push({ pattern, category });
                  checkedPatterns.add(patternKey);
               }
           } else if (isLargeContent) {
               console.warn(`[Pattern Match] Skipping includes() fallback for large content and pattern "${pattern}" due to performance concerns.`);
           }
      }
    }
  }

  if (findings.length > 0) {
    console.log(`[Pattern Match] Scan complete. Found ${findings.length} distinct potential patterns.`);
  } else {
      console.log("[Pattern Match] Scan complete. No known malicious patterns detected.");
  }

  return findings;
}


export async function analyzeFileContent(input: AnalyzeFileInput): Promise<AnalyzeFileOutput> {
  console.log(`[Server Action] Starting analysis for file: ${input.fileName}, type: ${input.contentType}, size approx: ${input.fileContent?.length ?? 0} chars (base64/dataURL)`);
  try {
    if (!input.fileName || !input.fileContent || !input.contentType) {
      console.error("[Server Action] Analysis failed: Missing required input data.", {fileName: input.fileName, contentType: input.contentType, hasContent: !!input.fileContent});
      return { error: "Missing required input data." };
    }

    // const isApk = input.contentType === 'application/vnd.android.package-archive' || input.fileName.endsWith('.apk'); // Removed APK check
    let fileDataToScan = '';
    let decodedSuccessfully = false;
    let decodeError: string | undefined = undefined;

    let base64Data = input.fileContent;
    const commaIndex = input.fileContent.indexOf(',');
    if (commaIndex !== -1) {
        base64Data = input.fileContent.substring(commaIndex + 1);
    }

    if (!base64Data) {
        console.warn("[Server Action] Empty content after removing potential data URL prefix.");
        return { error: "File content appears to be empty after processing.", findings: [], summary: "Analysis could not be performed: File content is empty." };
    }

    // Always attempt decoding for all file types.
    try {
        fileDataToScan = Buffer.from(base64Data, 'base64').toString('latin1');
        decodedSuccessfully = true;
        console.log("[Server Action] Base64 decoding successful.");
    } catch (e) {
        decodeError = e instanceof Error ? e.message : "Unknown Base64 decoding error";
        console.error(`[Server Action] Base64 decoding failed: ${decodeError}. Falling back to raw scan.`);
        fileDataToScan = base64Data; // Fallback to scanning raw base64 string
        decodedSuccessfully = false;
    }


    console.log("[Server Action] Starting pattern matching...");
    const detectedPatterns = findMaliciousPatterns(fileDataToScan);
    console.log(`[Server Action] Pattern matching complete. Found ${detectedPatterns.length} potential patterns. Decoded successfully: ${decodedSuccessfully}. Decode error: ${decodeError || 'None'}`);


    let analysisSummary = "Analysis complete.";
    let analysisResultsInputForAI = "";

    if (detectedPatterns.length > 0) {
        const detailedResults = detectedPatterns
            .map(f => `- Category: ${f.category}, Detected Pattern: "${f.pattern}"`)
            .join('\n');

        if (decodedSuccessfully) {
            analysisResultsInputForAI = `Analysis Results (${detectedPatterns.length} patterns found - Decoded Content Scan):\n${detailedResults}`;
        } else {
            analysisResultsInputForAI = `Analysis Results (${detectedPatterns.length} patterns found - Raw Base64 Scan due to decode error: ${decodeError}):\n${detailedResults}`;
        }

        console.log("[Server Action] Attempting to generate AI summary for detected patterns...");
        try {
            const summaryResult = await summarizeAnalysisResults({ analysisResults: analysisResultsInputForAI });
            analysisSummary = summaryResult.summary;
            console.log("[Server Action] AI summary generated successfully.");
        } catch (summaryError) {
            const errorMessage = summaryError instanceof Error ? summaryError.message : "An unknown error occurred during AI summary";
            console.error("[Server Action] Failed to get summary from AI:", errorMessage, summaryError);
            analysisSummary = `Potential threats detected (${detectedPatterns.length} patterns). Failed to generate detailed summary. Reason: ${errorMessage}`;
        }
    } else {
        if (decodedSuccessfully) {
            analysisResultsInputForAI = "Analysis Results: No known malicious patterns detected in the decoded file content based on the current ruleset.";
        } else {
            analysisResultsInputForAI = `Analysis Results: No known malicious patterns detected in the raw file content (Base64 decoding failed: ${decodeError}).`;
        }
         const safeSummaryResult = await summarizeAnalysisResults({ analysisResults: analysisResultsInputForAI });
         analysisSummary = safeSummaryResult.summary;
        console.log("[Server Action] No patterns detected. Using predefined safe summary.");
    }


    console.log(`[Server Action] Analysis finished for ${input.fileName}. Returning results.`);
    const finalResult: AnalyzeFileOutput = {
      findings: detectedPatterns,
      summary: analysisSummary,
      // isApk: isApk, // Removed
    };
    console.log(`[Server Action] Returning ${finalResult.findings?.length ?? 0} findings and summary for ${input.fileName}.`);
    return finalResult;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown server error occurred during analysis.";
    console.error(`[Server Action] CRITICAL ERROR during analysis for ${input?.fileName ?? 'unknown file'}:`, errorMessage, error instanceof Error ? error.stack : error);
    return { error: "An unexpected error occurred on the server during analysis. Please check server logs for details." };
  }
}
