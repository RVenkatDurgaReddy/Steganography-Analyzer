
'use server';

/**
 * @fileOverview Summarizes malware analysis results into a plain language explanation.
 *
 * - summarizeAnalysisResults - A function that summarizes the analysis results.
 * - SummarizeAnalysisResultsInput - The input type for the summarizeAnalysisResults function.
 * - SummarizeAnalysisResultsOutput - The return type for the summarizeAnalysisResults function.
 */

import {ai} from '@/ai/ai-instance';
import {z} from 'genkit';

const SummarizeAnalysisResultsInputSchema = z.object({
  analysisResults: z.string().describe('The detailed results of the malware analysis, including detected patterns and categories.'),
});
export type SummarizeAnalysisResultsInput = z.infer<typeof SummarizeAnalysisResultsInputSchema>;

const SummarizeAnalysisResultsOutputSchema = z.object({
  summary: z.string().describe('A plain language summary of the malware analysis results, focusing on potential threats.'),
});
export type SummarizeAnalysisResultsOutput = z.infer<typeof SummarizeAnalysisResultsOutputSchema>;

export async function summarizeAnalysisResults(input: SummarizeAnalysisResultsInput): Promise<SummarizeAnalysisResultsOutput> {
  if (/No known malicious patterns detected/i.test(input.analysisResults) && !/performed on raw Base64/i.test(input.analysisResults)) {
    console.log("[AI Flow] Skipping LLM summary for 'No patterns detected' result.");
    return { summary: "The analysis did not detect any known malicious code patterns based on the current ruleset." };
  }
  if (/No known malicious patterns detected.*performed on raw Base64/i.test(input.analysisResults)) {
      console.log("[AI Flow] Skipping LLM summary for 'No patterns detected in raw Base64' result.");
      const match = /Base64 decoding failed: (.*?)\)/.exec(input.analysisResults);
      const reason = match ? `(Reason: ${match[1]})` : '(Unknown reason)';
      return { summary: `No known malicious patterns were detected in the raw file content ${reason}. Base64 decoding failed, limiting the analysis.` };
  }

  console.log("[AI Flow] Calling LLM to summarize analysis results.");
  return summarizeAnalysisResultsFlow(input);
}

const summarizeAnalysisResultsPrompt = ai.definePrompt({
  name: 'summarizeAnalysisResultsPrompt',
  input: {
    schema: z.object({
      analysisResults: z.string().describe('The detailed results of the file analysis, listing detected patterns and their categories.'),
    }),
  },
  output: {
    schema: z.object({
      summary: z.string().describe('A concise, plain language summary focusing on potential threats. If no significant threats are found despite patterns being listed (e.g., only common encryption), state that clearly.'),
    }),
  },
  prompt: `You are a cybersecurity analyst reviewing file scan results. Summarize the findings for a non-technical user.

**Critical Instructions:**

1.  **Focus on High-Confidence Threats:** Prioritize patterns strongly indicative of malicious behavior (e.g., reverse shells, known malware commands like 'mimikatz', suspicious network connections to known bad domains, persistence mechanisms like adding startup entries, destructive commands like 'rm -rf /').
2.  **IGNORE Standard Encryption/Encoding UNLESS Suspicious Context:**
    *   **DO NOT** flag the mere presence of standard encryption libraries/functions (like AES, DES, RSA) or encoding (like Base64) as inherently suspicious or malicious. These are extremely common in legitimate software for security and data handling.
    *   **ONLY** mention encryption/encoding if the context strongly suggests malicious use (e.g., the analysis explicitly mentions it's used to obfuscate known malware, hide C2 communication, or is part of identified ransomware behavior). If the analysis just lists 'AES', 'DES', 'RSA' under a generic category like 'Encoding/Decoding' without further malicious context, **consider them benign for this summary**.
3.  **Reflect Analysis Limitations (If Mentioned):** If the input *analysisResults* explicitly mentions limitations like "performed on raw Base64" or "decoding failed", briefly include this caveat in your summary.
4.  **Clear "No Threat" Statement:** If the only detected patterns are common elements like standard encryption/encoding (which you should ignore per rule #2) or other low-confidence findings, clearly state that **no significant threats were detected** based on the analysis, even if the pattern list is not empty.
5.  **Be Concise:** Provide a brief, easy-to-understand summary. Avoid overly technical jargon.

**Analysis Results Provided:**
{{{analysisResults}}}

**Summary for User:**`,
});

const summarizeAnalysisResultsFlow = ai.defineFlow<
  typeof SummarizeAnalysisResultsInputSchema,
  typeof SummarizeAnalysisResultsOutputSchema
>({
  name: 'summarizeAnalysisResultsFlow',
  inputSchema: SummarizeAnalysisResultsInputSchema,
  outputSchema: SummarizeAnalysisResultsOutputSchema,
},
async input => {
  try {
    const {output} = await summarizeAnalysisResultsPrompt(input);
    if (!output) {
        throw new Error("AI summary generation returned no output.");
    }
    console.log("[AI Flow] Successfully generated AI summary.");
    let summary = output.summary;
     if (!/(reverse shell|malicious command|suspicious network|persistence|destructive|malware|threat|exploit|credential dumping|keylogger|ransomware)/i.test(summary) &&
         /analysisResults/.test(input.analysisResults) &&
         /(AES|DES|RSA|Base64)/i.test(input.analysisResults) &&
         !/malicious use|obfuscate|hide C2|ransomware behavior/i.test(input.analysisResults))
     {
        console.warn("[AI Flow] Post-processing: AI summary might have incorrectly focused on encryption. Adjusting to 'No significant threats'.");
        summary = "The analysis detected some common code patterns (like standard encryption) but found no indicators strongly suggesting malicious activity based on the current ruleset.";
        if (/performed on raw Base64|decoding failed/i.test(input.analysisResults)) {
            summary += " (Note: File analysis may have been limited due to content processing issues.)";
        }
     }


    return { summary };
  } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error during AI summary generation";
      console.error("[AI Flow] Error generating summary:", errorMessage, error);
      return { summary: `Analysis detected ${input.analysisResults.split('\n').length - 2} potential patterns. However, an error occurred while generating a detailed summary: ${errorMessage}` };
  }
});
