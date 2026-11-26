import type { ErrorRequestHandler, RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFoundHandler: RequestHandler = (_request, response, next) => {
  next(new HttpError(404, 'Rota não encontrada.'));
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (response.headersSent) {
    _next(error);
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.statusCode).json({ error: { message: error.message } });
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({ error: { message: 'Corpo JSON inválido.' } });
    return;
  }

  response.status(500).json({ error: { message: 'Erro interno do servidor.' } });
};
