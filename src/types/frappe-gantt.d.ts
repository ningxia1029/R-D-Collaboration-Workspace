declare module "frappe-gantt" {
  export interface GanttTask {
    id: string;
    name: string;
    start: string;
    end: string;
    progress: number;
    dependencies?: string;
    custom_class?: string;
  }

  export interface GanttOptions {
    view_mode?: string;
    language?: string;
    readonly?: boolean;
    popup?: false | ((ctx: { task: { name: string; _start: Date; _end: Date; progress: number } }) => string | false);
    on_click?: (task: GanttTask) => void;
    on_date_change?: (task: GanttTask, start: Date, end: Date) => void;
  }

  export default class Gantt {
    constructor(wrapper: string | HTMLElement | SVGElement, tasks: GanttTask[], options?: GanttOptions);
    refresh(tasks: GanttTask[]): void;
    change_view_mode(mode: string): void;
  }
}

declare module "frappe-gantt/dist/frappe-gantt.js" {
  export { GanttTask, GanttOptions } from "frappe-gantt";
  const Gantt: typeof import("frappe-gantt").default;
  export default Gantt;
}
