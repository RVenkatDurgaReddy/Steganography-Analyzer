"use client";

import { useState, useCallback, useTransition, type ChangeEvent, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, FileText, Image as ImageIcon, Music, Video, ShieldAlert, ShieldCheck, Info, X, AlertTriangle } from "lucide-react";
import { analyzeFileContent } from "@/actions/analyze-file";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

interface AnalysisResult {
  fileName: string;
  findings?: { pattern: string; category: string }[];
  isMalicious: boolean;
  summary?: string;
  error?: string; 
}

type AnalysisState = "idle" | "uploading" | "analyzing" | "analyzed" | "error";

const MAX_FILE_SIZE_GB = 1; 
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_GB * 1024 * 1024 * 1024;

export function FileAnalyzer() {
  const [files, setFiles] = useState<File[]>([]);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([]);
  const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
  const [currentAnalyzingFile, setCurrentAnalyzingFile] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, startTransition] = useTransition();
  const { toast } = useToast();

  const processFiles = useCallback((selectedFiles: FileList | null) => {
    if (!selectedFiles) return;

    const newFiles: File[] = [];
    const invalidFiles: { name: string, reason: string }[] = [];

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const fileType = file.type;
      const isMediaFile = ['image/', 'audio/', 'video/'].some(type => fileType.startsWith(type));

      if (file.size > MAX_FILE_SIZE_BYTES) {
        invalidFiles.push({ name: file.name, reason: `Exceeds ${MAX_FILE_SIZE_GB}GB limit.` });
        continue;
      }
      if (!isMediaFile) {
        invalidFiles.push({ name: file.name, reason: "Invalid file type (must be image, audio, or video)." });
        continue;
      }
      newFiles.push(file);
    }

    setFiles(prevFiles => [...prevFiles, ...newFiles].filter((file, index, self) =>
        index === self.findIndex((f) => (
            f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
        ))
    ));

    if (invalidFiles.length > 0) {
      toast({
        variant: "destructive",
        title: "Some Files Skipped",
        description: (
          <div>
            {invalidFiles.map(f => <p key={f.name}>{f.name}: {f.reason}</p>)}
          </div>
        ),
        duration: 7000,
      });
    }

    setAnalysisResults([]);
    setAnalysisState("idle");
  }, [toast]);


  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    processFiles(event.target.files);
    if (event.target) {
        event.target.value = ""; 
    }
  };

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    processFiles(event.dataTransfer.files);
  }, [processFiles]);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error("Failed to read file as Data URL."));
        }
      };
      reader.onerror = (error) => {
        console.error("[FileReader] Error:", error);
        reject(error.target?.error || new Error("FileReader error"));
      };
      reader.readAsDataURL(file);
    });
  };

  const handleAnalyze = async () => {
    if (files.length === 0) {
      toast({
        variant: "destructive",
        title: "No Files Selected",
        description: "Please select one or more files to analyze.",
      });
      return;
    }

    setAnalysisState("analyzing");
    setAnalysisResults([]);
    let overallError = false;

    startTransition(async () => {
      const resultsAccumulator: AnalysisResult[] = [];
      for (let i = 0; i < files.length; i++) {
        const currentFile = files[i];
        setCurrentAnalyzingFile(`Analyzing ${currentFile.name} (${i + 1} of ${files.length})...`);

        try {
          const fileContent = await readFileAsDataURL(currentFile);
          const serverResult = await analyzeFileContent({
            fileName: currentFile.name,
            fileContent: fileContent,
            contentType: currentFile.type,
          });

          if (serverResult.error) {
            resultsAccumulator.push({
              fileName: currentFile.name,
              isMalicious: true, 
              error: serverResult.error,
              findings: [],
              summary: `Error analyzing file: ${serverResult.error}`,
            });
            overallError = true;
          } else {
            resultsAccumulator.push({
              fileName: currentFile.name,
              findings: serverResult.findings || [],
              isMalicious: (serverResult.findings?.length ?? 0) > 0,
              summary: serverResult.summary,
            });
          }
        } catch (error) {
          console.error(`Error processing file ${currentFile.name}:`, error);
          resultsAccumulator.push({
            fileName: currentFile.name,
            isMalicious: true,
            error: error instanceof Error ? error.message : "An unknown error occurred during file processing.",
            findings: [],
            summary: `Failed to process file: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
          overallError = true;
        }
        setAnalysisResults([...resultsAccumulator]); 
      }

      setCurrentAnalyzingFile(null);
      setAnalysisState(overallError ? "error" : "analyzed"); 
      if (!overallError && resultsAccumulator.length > 0) {
        toast({
            title: "Analysis Complete",
            description: `Finished analyzing ${resultsAccumulator.length} file(s).`,
        });
      } else if (overallError) {
         toast({
            variant: "destructive",
            title: "Analysis Partially Completed",
            description: `Some files could not be analyzed. Check results for details.`,
        });
      }
    });
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith('image/')) return <ImageIcon className="mr-2 h-5 w-5 text-muted-foreground flex-shrink-0" />;
    if (fileType.startsWith('audio/')) return <Music className="mr-2 h-5 w-5 text-muted-foreground flex-shrink-0" />;
    if (fileType.startsWith('video/')) return <Video className="mr-2 h-5 w-5 text-muted-foreground flex-shrink-0" />;
    return <FileText className="mr-2 h-5 w-5 text-muted-foreground flex-shrink-0" />;
  };

  const formatBytes = (bytes: number, decimals = 2) => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const dm = decimals < 0 ? 0 : decimals;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
      if (bytes < 1) return `${bytes} Bytes`; // Handle very small files
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      const index = Math.min(i, sizes.length - 1); // Prevent out of bounds for extremely large numbers not in sizes
      return parseFloat((bytes / Math.pow(k, index)).toFixed(dm)) + ' ' + sizes[index];
  }

  const removeFile = (indexToRemove: number) => {
    setFiles(prevFiles => prevFiles.filter((_, index) => index !== indexToRemove));
    if (files.length === 1) {
        setAnalysisResults([]);
        setAnalysisState("idle");
    }
  };

  const clearAllFiles = () => {
    setFiles([]);
    setAnalysisResults([]);
    setAnalysisState("idle");
    setCurrentAnalyzingFile(null);
  };

  return (
    <div className="container mx-auto p-4 md:p-8 max-w-4xl">
      <Toaster />
      <Card className="w-full shadow-xl border border-border/20 rounded-xl overflow-hidden bg-card/95 backdrop-blur-sm">
        <CardHeader className="bg-gradient-to-r from-primary/10 via-background to-secondary/10 p-6 border-b border-border/10">
          <div className="flex items-center justify-center mb-3">
             <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary mr-3"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><path d="M12 9v4l2 2"></path><circle cx="12" cy="12" r="10"></circle></svg>
            <CardTitle className="text-3xl font-bold tracking-tight text-foreground">Steganography Analyzer</CardTitle>
          </div>
          <CardDescription className="text-center text-muted-foreground text-md">
            Upload image, audio, or video files (up to {MAX_FILE_SIZE_GB}GB each) to scan for potential malicious code snippets. Supports multiple file uploads.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 md:p-8 space-y-8">
          <div
            className={`relative flex flex-col items-center justify-center p-10 border-2 border-dashed rounded-lg transition-colors duration-300 ease-in-out ${
              isDragging ? 'border-primary bg-primary/5' : 'border-input hover:border-primary/70 hover:bg-muted/30'
            } cursor-pointer`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => document.getElementById('file-upload-multiple')?.click()}
            onKeyPress={(e) => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('file-upload-multiple')?.click(); }}
            aria-label={`Upload file area, accepts multiple image, audio, or video files up to ${MAX_FILE_SIZE_GB}GB each`}
          >
             <div className="absolute top-3 right-3 text-xs text-muted-foreground flex items-center p-1.5 bg-background/80 rounded-full shadow-sm border border-border/50">
               <Info className="w-3.5 h-3.5 mr-1 text-primary" />
               <span>Max {MAX_FILE_SIZE_GB}GB per file</span>
             </div>
            <Upload className="w-12 h-12 text-primary mb-3" />
            <p className="mb-2 text-lg text-foreground text-center">
              <span className="font-semibold text-primary hover:underline">Click to upload</span> or drag and drop files
            </p>
            <p className="text-sm text-muted-foreground">Supports multiple image, audio, or video files</p>
            <input
              id="file-upload-multiple"
              type="file"
              multiple
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={handleFileChange}
              accept="image/*,audio/*,video/*"
            />
          </div>

          {files.length > 0 && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-foreground">Selected Files ({files.length}):</h3>
                <Button variant="outline" size="sm" onClick={clearAllFiles} className="text-destructive hover:bg-destructive/10 border-destructive/50 hover:border-destructive">
                  Clear All
                </Button>
              </div>
              <ScrollArea className="h-40 w-full rounded-md border bg-muted/20 p-3 shadow-inner">
                <ul className="space-y-2">
                  {files.map((f, index) => (
                    <li key={`${f.name}-${f.lastModified}-${index}`} className="flex items-center justify-between p-2.5 border border-border/30 rounded-md bg-background shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center overflow-hidden mr-2 min-w-0">
                        {getFileIcon(f.type)}
                        <span className="text-sm font-medium truncate ml-1 text-foreground" title={f.name}>{f.name}</span>
                      </div>
                      <div className="flex items-center flex-shrink-0">
                        <span className="text-xs text-muted-foreground mr-3">
                          ({formatBytes(f.size)})
                        </span>
                        <Button variant="ghost" size="icon" onClick={() => removeFile(index)} className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                          <X className="h-4 w-4" />
                          <span className="sr-only">Remove {f.name}</span>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          )}

          {(analysisState === "analyzing" || isAnalyzing) && (
             <div className="mt-6 text-center">
                <div className="flex justify-center items-center mb-2">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
                <p className="text-md font-medium text-primary">
                   {currentAnalyzingFile || "Initializing analysis..."}
                </p>
             </div>
           )}

          <div className="mt-8 flex justify-center">
            <Button
              onClick={handleAnalyze}
              disabled={files.length === 0 || isAnalyzing || analysisState === 'analyzing'}
              className="w-full md:w-1/2 lg:w-1/3 py-3 text-base font-semibold transition-all duration-200 ease-in-out hover:shadow-lg focus:ring-2 focus:ring-offset-2 focus:ring-primary/80 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
              size="lg"
              aria-live="polite"
              aria-busy={isAnalyzing || analysisState === 'analyzing'}
            >
              {isAnalyzing || analysisState === 'analyzing' ? 'Analyzing...' : `Analyze ${files.length > 0 ? files.length : ''} File${files.length === 0 || files.length > 1 ? 's' : ''}`}
            </Button>
          </div>

          {analysisResults.length > 0 && analysisState !== 'analyzing' && (
            <div className="mt-10 space-y-6">
              <h2 className="text-2xl font-semibold text-center text-foreground">Analysis Results</h2>
              {analysisResults.map((result, index) => (
                <Card key={`${result.fileName}-${index}`} className={`shadow-lg border rounded-lg overflow-hidden ${result.error ? 'border-destructive/50 bg-destructive/5' : (result.isMalicious ? 'border-destructive/30 bg-card' : 'border-green-500/30 bg-card')}`}>
                  <CardHeader className={`border-b pb-4 ${result.error ? 'bg-destructive/10' : (result.isMalicious ? 'bg-destructive/5' : 'bg-green-500/5')}`}>
                    <CardTitle className="flex items-center text-xl font-semibold text-foreground">
                      {result.error ? (
                        <AlertTriangle className="w-7 h-7 mr-3 text-destructive flex-shrink-0" />
                      ) : result.isMalicious ? (
                        <ShieldAlert className="w-7 h-7 mr-3 text-red-600 flex-shrink-0" />
                      ) : (
                        <ShieldCheck className="w-7 h-7 mr-3 text-green-600 flex-shrink-0" />
                      )}
                      <span className="font-mono ml-2 truncate text-primary flex-shrink min-w-0" title={result.fileName}>{result.fileName}</span>
                    </CardTitle>
                     <CardDescription className="mt-2 pl-10 text-card-foreground/90">
                        {result.summary || (result.isMalicious && !result.error ? "Potential threats detected based on pattern matching." : (!result.error ? "No known malicious patterns detected." : "An error occurred during analysis."))}
                     </CardDescription>
                  </CardHeader>
                  {!result.error && (
                    <CardContent className="p-6">
                      {result.findings && result.findings.length > 0 ? (
                        <div>
                           <h3 className="text-base font-semibold mb-3 text-foreground">Detected Patterns ({result.findings.length}):</h3>
                           <ScrollArea className="h-48 max-h-[200px] w-full rounded-md border bg-muted/30 p-4 shadow-inner">
                             <ul className="space-y-4">
                               {result.findings.map((finding, findIndex) => (
                                 <li key={`${result.fileName}-finding-${findIndex}`} className="flex items-start space-x-3 p-3 rounded bg-background shadow-sm border border-border/20">
                                  <ShieldAlert className="w-5 h-5 text-destructive flex-shrink-0 mt-1" />
                                  <div className="min-w-0">
                                     <Badge variant="destructive" className="mb-1.5">{finding.category}</Badge>
                                     <p className="text-sm font-mono break-words text-foreground leading-relaxed">
                                       {finding.pattern}
                                     </p>
                                   </div>
                                 </li>
                               ))}
                             </ul>
                           </ScrollArea>
                        </div>
                      ) : (
                        <Alert variant="default" className="border-green-300 bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200 dark:border-green-700 shadow-sm">
                           <ShieldCheck className="h-5 w-5 !text-green-600 dark:!text-green-400" />
                          <AlertTitle className="font-semibold text-green-900 dark:text-green-100">No Threats Found</AlertTitle>
                          <AlertDescription className="text-green-800 dark:text-green-200 mt-1">
                            The analysis did not detect any known malicious code patterns in this file based on the current ruleset.
                          </AlertDescription>
                        </Alert>
                      )}
                    </CardContent>
                  )}
                  {result.error && (
                      <CardContent className="p-6">
                          <Alert variant="destructive" className="shadow-sm">
                            <AlertTriangle className="h-5 w-5" />
                            <AlertTitle className="font-semibold">Analysis Error</AlertTitle>
                            <AlertDescription className="mt-1">
                                {result.summary || "An error occurred while analyzing this file."}
                            </AlertDescription>
                         </Alert>
                      </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}

           {analysisState === "error" && analysisResults.length === 0 && ( 
             <Alert variant="destructive" className="mt-10 shadow-sm">
                <AlertTriangle className="h-5 w-5" />
                <AlertTitle className="font-semibold">Analysis Error</AlertTitle>
                <AlertDescription className="mt-1">
                    An error occurred during file processing or analysis. Browser limitations with large files are common. Please check the console (F12) for more details or try smaller files.
                </AlertDescription>
             </Alert>
           )}
        </CardContent>
      </Card>
    </div>
  );
}
