export interface Design {
    // elementID: - showProbability
}


export interface ElementAction {
    elementID: string;
    actionID: string;
    actionType: 'click' | 'mouseEnter' | 'mouseLeave';
}

export interface ElementActionClick extends ElementAction {
    actionType: 'click';
    eventData: any;
}


export interface IAptuitive {
    /**
    * Add elements to be tracked for usage and determine
    * if they are to be included in the User Interface.
    *
    * @param element
    */
   add: (
       WrappedComponent: React.FC<any>,
   ) => React.FC<any>;

   design: () => any;
}


export interface AptuitiveOptions {
   hideOnly: boolean;
}


export interface AptuitiveProperties {
   aptID: string;
   [key: string]: any;
}
