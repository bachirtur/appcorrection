declare module 'multer' {
  interface Options {
    storage?: unknown;
    limits?: { fileSize?: number };
  }

  interface MulterInstance {
    single(fieldName: string): import('express').RequestHandler;
  }

  function multer(options?: Options): MulterInstance;
  namespace multer {
    function memoryStorage(): unknown;
  }
  export default multer;
}

declare namespace Express {
  interface Request {
    file?: {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    };
  }
}
