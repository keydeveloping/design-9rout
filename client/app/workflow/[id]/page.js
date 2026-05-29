import React from 'react';
import WorkflowBuilderClient from "./WorkflowBuilderClient";

const apiBaseUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

async function fetchWorkflowData(id) {
  const baseUrl = `${apiBaseUrl}/api/workflow`;
  try {
    const [workflowResult, schemasResult] = await Promise.allSettled([
      fetch(`${baseUrl}/get-workflow-def/${id}`, {
        cache: 'no-store'
      }),
      fetch(`${baseUrl}/${id}/node-schemas`, {
        cache: 'no-store'
      })
    ]);

    const workflowRes = workflowResult.status === "fulfilled" ? workflowResult.value : null;
    const schemasRes = schemasResult.status === "fulfilled" ? schemasResult.value : null;
    const initialWorkflowData = workflowRes?.ok ? await workflowRes.json() : null;
    const initialNodeSchemas = schemasRes?.ok ? await schemasRes.json() : null;

    if (schemasResult.status === "rejected" || (schemasRes && !schemasRes.ok)) {
      console.warn("Node schema fetch failed on server; client will retry.");
    }

    return { initialWorkflowData, initialNodeSchemas };
  } catch (error) {
    console.error("Error fetching workflow data on server:", error);
    return { initialWorkflowData: null, initialNodeSchemas: null };
  }
}

export default async function WorkflowPage({ params }) {
  const { id } = await params;

  const { initialWorkflowData, initialNodeSchemas } = await fetchWorkflowData(id);

  return (
    <div className="h-dvh w-full bg-black">
      <WorkflowBuilderClient 
        initialWorkflowData={initialWorkflowData} 
        initialNodeSchemas={initialNodeSchemas} 
      />
    </div>
  );
}
