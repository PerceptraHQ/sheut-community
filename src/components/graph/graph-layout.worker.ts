import { arrangeGraph, type LayoutNode, type LayoutRequest } from "./layout";

export interface LayoutResponse {
  requestId: string;
  nodes: LayoutNode[];
}

interface WorkerRequest extends LayoutRequest {
  requestId: string;
}

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (response: LayoutResponse) => void;
};

workerScope.onmessage = ({ data }) => {
  workerScope.postMessage({
    requestId: data.requestId,
    nodes: arrangeGraph(data),
  });
};
