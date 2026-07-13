export interface NotifyPayload {
  title: string;
  body: string;
  url: string;
}

export interface CellChange {
  cell: string;
  before: string;
  after: string;
}
