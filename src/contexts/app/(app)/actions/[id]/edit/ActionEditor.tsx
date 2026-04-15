"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { useActionsData } from "@/hooks/use-actions-data";

interface ActionEditorProps {
  actionId: string;
}

export default function ActionEditor({ actionId }: ActionEditorProps) {
  const router = useRouter();
  const { actions, isLoading } = useActionsData();
  const [action, setAction] = useState<any>(null);

  useEffect(() => {
    const foundAction = actions.find(a => a.id === actionId);
    if (foundAction) {
      setAction(foundAction);
    }
  }, [actions, actionId]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!action) {
    return <div>Action not found</div>;
  }

  const subActions = Array.isArray(action.subActions) ? action.subActions : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <h1 className="text-2xl font-bold">{action.name}</h1>
        <Badge variant={action.enabled ? "default" : "secondary"}>
          {action.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Action Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <strong>ID:</strong> {action.id}
            </div>
            <div>
              <strong>Group:</strong> {action.group || "None"}
            </div>
            <div>
              <strong>Triggers:</strong> {action.triggers?.length || 0}
            </div>
            <div>
              <strong>Sub-Actions:</strong> {subActions.length}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sub-Actions ({subActions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {subActions.map((subAction: any, index: number) => (
              <div key={subAction.id || index} className="border rounded p-3">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium">
                      {index + 1}. Type: {subAction.type}
                    </div>
                    <div className="text-sm text-gray-600">
                      ID: {subAction.id}
                    </div>
                    {subAction.text && (
                      <div className="text-sm mt-1">
                        <strong>Text:</strong> {subAction.text}
                      </div>
                    )}
                    {subAction.actionId && (
                      <div className="text-sm mt-1">
                        <strong>Action ID:</strong> {subAction.actionId}
                      </div>
                    )}
                    {subAction.userLogin && (
                      <div className="text-sm mt-1">
                        <strong>User:</strong> {subAction.userLogin}
                      </div>
                    )}
                  </div>
                  <Badge variant={subAction.enabled !== false ? "default" : "secondary"}>
                    {subAction.enabled !== false ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
              </div>
            ))}
            {subActions.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                No sub-actions found
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}