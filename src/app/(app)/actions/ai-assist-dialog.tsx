
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Wand2, LoaderCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { generateActionCode } from "@/ai/flows/generate-action-code";

interface AiAssistDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onCodeGenerated: (code: string) => void;
  language: string;
}

export function AiAssistDialog({ isOpen, setIsOpen, onCodeGenerated, language }: AiAssistDialogProps) {
  const { toast } = useToast();
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerateCode = async () => {
    if (!description) return;
    setIsLoading(true);
    try {
      const result = await generateActionCode({ description, language });
      onCodeGenerated(result.code);
      setIsOpen(false);
      setDescription("");
       toast({
        title: "Code generated successfully!",
        description: "The AI assistant has written the code for you.",
      });
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Error generating code",
        description: "An error occurred while communicating with the AI.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>AI Code Assistant</DialogTitle>
          <DialogDescription>
            Describe what you want the code to do, and the AI will write it for you.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid w-full items-center gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="e.g., Send a chat message that says 'Welcome to the stream!' and then play a sound effect."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleGenerateCode} disabled={isLoading}>
            {isLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            Generate Code
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
