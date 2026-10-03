import React from 'react';

import Aptuitive from '@plurid/aptuitive-react';


const userDesigns = {
}

const Button = () => {
    return (
        <button>
            button
        </button>
    );
}

const aptuitive = new Aptuitive(userDesigns);

const AptButton = aptuitive.add(Button);


const App = () => {
    return (
        <div>
            <AptButton
                aptID="button-1"
            />

            <AptButton
                aptID="button-2"
            />
        </div>
    );
}


export default App;
