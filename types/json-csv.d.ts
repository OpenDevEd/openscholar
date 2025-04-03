declare module 'json-csv' {
  interface Field {
    name: string;
    label?: string;
    filter?: (value: any) => any;
  }

  interface Options {
    fields: Field[];
  }

  function buffered(data: any[] | object, options: Options): Promise<string>;

  export = {
    buffered
  };
} 